import { App, createNodeMiddleware } from '@octokit/app';
import { createAppAuth } from '@octokit/auth-app';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import CIManager from './CIManager';
import express from "express";


dotenv.config();


// const app = new App({
//     authStrategy: createAppAuth,
//     appId: 157610, //TODO process.env
//     privateKey: readFileSync(process.env.PRIVATE_KEY_FILE || '', 'utf8'),
//     oauth: {
//         clientId: process.env.OAUTH_CLIENT_ID || '',
//         clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
//     },
//     webhooks: {
//         secret: process.env.WEBHOOK_SECRET || '',
//     },
// });

const app = new App({
    authStrategy: createAppAuth,
    appId: 242778, //TODO process.env
    privateKey: `-----BEGIN RSA PRIVATE KEY-----
    MIIEpAIBAAKCAQEA0QQ6JjT3BJTQcYxBN0W4xMqbbiK2dJSgux2FowLruD+s/3Rc
    ry5Zop5CSJpKYmECdhJMYvAh8n0ASDWv/+WcRyQCVsV7n3cUKLz4CMeoP3wgtjNa
    ClPHU9lNllQ/RW90AEa0U2aBkLFwHlc8iZBVhYb3h6MjJFr9dqMri8K487FiMHot
    dZb9vKJyOB1yUO3vANCKH9zDQOkq5QHy73wYDO502gWS3hIGCmo2xYUP/Y9+dam7
    ynCtCnqboUxyoNpMmzq/mtx+pvFIsr9kVtfzivTqYWHldW0S+L2pIDo8pan3Sn/w
    NoXxc6BOy+bjxcOSrC3CbFbPLecfsn3vKGwVowIDAQABAoIBAGg1xlQ0RhBHreFe
    /0jyfxvGtFXmArf/Pl/saSuMEkBrpvI6btd8sX4Nj5ipLHr+SP7bQrB1b0d6IUDf
    W5+nOBKUFoJytZ8c/LUO+k9OVElKtviAg9zwRko85p0T5fPVjK1ykwed7O1aOj82
    WV1w0+LeFt3ObX/7ybFzywtEi3gbyspy46eyqCuYboroQY76Mm0NxxI2qUMMKSHa
    ObwsLVuk7fo6rq3/nt9ZfjecrDCnj34Ew91Ex452CVp7CSlYCjJH+B6q4hAy4Wfw
    31cDHtNTnBrATo1UUpfSK0FHi96M5CaImbX4U+GI341G88jemTWR+zaMTIOU8umC
    QQn517kCgYEA7f1rv6ZTJ3NcYvh8x/uMeGf3sQpopDp6kuCRpTKon5s2dkMxoObT
    wON6gxbf0l3BIWW17HQ0uukTlEVKs1Ln40jiQBImx3cp3A5y8oaUpQuwNuPIYxEX
    unyLk3H7HHQKet9f4HgqQey/h+sTt0Ofp5HoxdNu3x47knJJrseTYm0CgYEA4NWB
    GOpo74EXaRQ3hwNAR65B/zswEqICyVQ9kbNozeInHBPvhi+SmK2u33I7kT3nuzMw
    5fSZuJ0hvWM6NwwwOygphJkdoTmotx7E3r+kT0z1Ruv+5XMIRqTyKxbnkEbdZf/8
    t5MoOG6fpWIwJ/Et1CVAldUutVtBiz3UMX2Rzk8CgYEA5zA3a4V3Yet+4+Xf0aVb
    X9wfkaw62s60I9pjoccEZ4ev8FJ184hITCiu6oleBE1vP7I+d+SrFKc2jeKCHpF7
    Eh/LKdJ4OWxZDZw7rb1uyKYCGFBOaW5BTreOHz2qYomXZKV5zeTtp/0EUlTaYj0e
    6vmi1gn+ul/0Ht9HFLJrSkECgYEAm4LRwnwQjOiLWsEDDz2ubmYXfARiYeDxcHP2
    Chs/+HfeeUtIt1WcXkJz3FXU4cchy5fC0Kt4z/rPZYGGuKCTk7dZ0D9gAS4yhkag
    AToo2jjuxllhey8voD1iy28SR/bcGDsRf6Anh7Dsd6YMjPQCsOP7YieMISC3mynu
    5TRnb30CgYBeGEPX8lb3Q8BA3a9qmNzKKuCDDXbqMH+JbgW9/UM78i52RLrWJ8A8
    DmxDFd4cAfp0V4kFfxmORcYKZfhby+aNBLoFXlrHKhWMMTGFMdHHuV9Q+Tf/z32a
    56AL/KVnr7hzyfrOE6YkXUKFHjI8TMAiiaaWqRZHZ5dt/Hlom2k88g==
    -----END RSA PRIVATE KEY-----`,
    oauth: {
        clientId: "Iv1.aefe69d305fba327",
        clientSecret: "8fc82fb232c74d239ef5c059947a3d39d4a91259",
    },
    webhooks: {
        secret: "secret",
    },
});

// //TODO add workflow finished/canceled
// app.webhooks.on("workflow_job.queued", async ({ octokit, payload }) => {
//     try {
// 		console.log(payload.workflow_job);
//         if (payload.workflow_job.labels.includes("dev"))
//             return;
//         if(!payload.workflow_job.labels.includes('self-hosted')){
//             //check for substring, maybe we customized it and didn't succeed in building an array...
//             let found = false;
//             for(let label of payload.workflow_job.labels){
//                 if(label.includes('self-hosted')){
//                     found = true;
//                     break;
//                 }
//             }
//             if(!found){
//                 console.log("Could not find self-hosted tag on this request, bailing")
//                 return;
//             }
//         }
//         await CIManager.getInstance(app).launchBuildJob({
//             owner: payload.repository.owner.login,
//             repositoryName: payload.repository.name,
//             repositoryURL: payload.repository.html_url,
//             labels: payload.workflow_job.labels
//         });
//     } catch (err) {
//         console.trace(err);
//     }
// });

app.webhooks.on("workflow_job.queued", async ({ octokit, payload }) => {
    console.log("Received workflow job event\n");
    console.log(payload.workflow_job);
});

app.oauth.on("token", async ({ token, octokit }) => {
    const { data } = await octokit.request("GET /user");
    console.log(`Token retrieved for ${data.login}`);
});

const expressApp = express();
expressApp.use(createNodeMiddleware(app));
// const ciApp = CIManager.getInstance(app);

expressApp.post("/gha/runner", async (req, res) => {
    const header = req.headers.authorization;
    // if (header) {
    //     try {
    //         const { token } = await ciApp.validateAndGetGHAToken(header);
    //         return res.json({ token });
    //     } catch (err) {
    //         console.trace(err);
    //         return res.status(500).send();
    //     }
    // }
    // console.error("Received an invalid request with no auth header!")
    // return res.status(403).send();
    return res.status(200).send("Hello world");
});

expressApp.listen(process.env.PORT || 5050, async () => {
    console.log(`Listening`);
    // await ciApp.initializeApp();
    /*for(let i=0;i<1;i++){
    ciApp.launchBuildJob({
        owner: 'jon-bell',
        repositoryName: 'confetti-action-dev',
        repositoryURL: 'https://github.com/jon-bell/confetti-action-dev',
        labels: ['self-hosted.24gb']
    })
    }*/
});
