import {
    Connection,
    Keypair,
    Transaction,
    VersionedTransaction,
    TransactionMessage,

} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,

} from "@solana/spl-token";
import dotenv from "dotenv";
import bs58 from 'bs58'
import got from "got";
import fs from 'fs'

dotenv.config();

const wallet = (
    Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY))//your wallet
);

const connection = new Connection(process.env.RPC_URL);
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SLEEP_TIME = 5000 //time to wait between sell orders

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))


//get route for swap
const getCoinQuote = (inputMint, outputMint, amount) =>
    got
        .get(
            `https://quote-api.jup.ag/v1/quote?outputMint=${outputMint}&inputMint=${inputMint}&amount=${amount}&slippageBps=20`
        )
        .json()




//get unsigned transaction for swap 
const getTransaction = (route) => {
    return got
        .post("https://quote-api.jup.ag/v1/swap", {
            json: {
                route: route,
                userPublicKey: wallet.publicKey.toString(),
                // to make sure it doesnt close the sol account
                wrapUnwrapSOL: false,
            },
        })
        .json()

};


async function liq() {
    let parsedTokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM_ID })

    parsedTokenAccounts.value = parsedTokenAccounts.value.filter((token) => {
        return token.account.data.parsed.info.tokenAmount.amount > 1;
    })

    console.log(parsedTokenAccounts.value.length + ' tokens to liquidate')


    for (let element of parsedTokenAccounts.value) {
        await sleep(SLEEP_TIME)
        if (element.account.data.parsed.info.mint != USDC_MINT) {


            let swap;
            try {

                swap = await getCoinQuote(
                    element.account.data.parsed.info.mint,
                    USDC_MINT,
                    element.account.data.parsed.info.tokenAmount.amount - 1
                )
            } catch (e) {
               
                continue;
            }


            let instructions = []

            console.log('Selling ' + element.account.data.parsed.info.tokenAmount.amount + ' ' + element.account.data.parsed.info.mint)

            let data;
            try {
                data = await getTransaction(swap.data[0])
            } catch (e) {
             
                continue;
            }


            await Promise.all(
                [data.setupTransaction, data.swapTransaction, data.cleanupTransaction]
                    .filter(Boolean)
                    .map(async (serializedTransaction) => {


                        let transaction = Transaction.from(
                            Buffer.from(serializedTransaction, "base64")
                        );
                        try {
                            instructions.push(...transaction.instructions)
                            /*   if (transaction.signers) {
                                   if (transaction.signers.length > 0) {
                                       signers.push(...transaction.signers)
                                   }
                               } */
                        } catch (err) {
                            console.log(err)
                        }
                    })
            );

            let blockhash = await connection
                .getLatestBlockhash()
                .then((res) => res.blockhash);

            let messageV00 = new TransactionMessage({
                payerKey: wallet.publicKey,
                recentBlockhash: blockhash,
                instructions,
            }).compileToV0Message([]);

            let transaction = new VersionedTransaction(messageV00);

            transaction.sign([wallet])

            let txn = await connection.sendTransaction(transaction, { skipPreflight: true })

                .catch(e => {
                    console.log('err : ' + e)
                })

            console.log('txn : ' + txn)


        }
    }

}



liq()