import { App, createNodeMiddleware } from '@octokit/app';
import { createAppAuth } from '@octokit/auth-app';
import * as dotenv from 'dotenv';
import { appendFileSync, readFile, readFileSync } from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import CIManager from './CIManager';
import express, { response } from "express";
import { Response } from 'node-fetch';
import { workerData } from 'worker_threads';
import cors from 'cors';


dotenv.config();

const app = new App({
    authStrategy: createAppAuth,
    appId: process.env.APP_ID || 242778, //TODO process.env
    privateKey: readFileSync(process.env.PRIVATE_KEY_FILE || '', 'utf8'),
    oauth: {
        clientId: process.env.OAUTH_CLIENT_ID || '',
        clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
    },
    webhooks: {
        secret: process.env.WEBHOOK_SECRET || '',
    },
});

app.webhooks.on("workflow_job.queued", async ({ octokit, payload }) => {
    try {
        if (payload.workflow_job.labels.includes("dev"))
            return;
        if (!payload.workflow_job.labels.includes('self-hosted')) {
            //check for substring, maybe we customized it and didn't succeed in building an array...
            let found = false;
            for (let label of payload.workflow_job.labels) {
                if (label.includes('self-hosted')) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                console.log("Could not find self-hosted tag on this request, bailing")
                return;
            }
        }
        await CIManager.getInstance(app).launchBuildJob({
            owner: payload.repository.owner.login,
            repositoryName: payload.repository.name,
            repositoryURL: payload.repository.html_url,
            labels: payload.workflow_job.labels,
            workflowId: payload.workflow_job.id
        });
    } catch (err) {
        console.trace(err);
    }
});

app.webhooks.on("workflow_job.in_progress", async ({ octokit, payload }) => {
    try {
        const res = await CIManager.getInstance(app).removeBuildJob({
            owner: payload.repository.owner.login,
            repositoryName: payload.repository.name,
            repositoryURL: payload.repository.html_url,
            labels: payload.workflow_job.labels,
            workflowId: payload.workflow_job.id
        })
        if (res) {
            console.log("Build job " + payload.workflow_job.id + " was sucessfully started");
        } else {
            console.log("Build job " + payload.workflow_job.id + " was not found, could not be removed");
        }
    }
    catch (err) {
        console.trace(err);
    }
});

app.webhooks.on("workflow_job.completed", async ({ octokit, payload }) => {
    try {
        if (payload.workflow_job.conclusion === "cancelled") {
            const res = await CIManager.getInstance(app).removeBuildJob({
                owner: payload.repository.owner.login,
                repositoryName: payload.repository.name,
                repositoryURL: payload.repository.html_url,
                labels: payload.workflow_job.labels,
                workflowId: payload.workflow_job.id
            });
            if (res) {
                console.log("Build job was sucessfully cancelled");
            } else {
                console.log("Build job was not found, could not be cancelled");
            }
        }
    } catch (err) {
        console.trace(err);
    }
});

app.oauth.on("token", async ({ token, octokit }) => {
    const { data } = await octokit.request("GET /user");
    console.log(`Token retrieved for ${data.login}`);
});

const expressApp = express();
expressApp.use(cors());
expressApp.use(createNodeMiddleware(app));
const ciApp = CIManager.getInstance(app);

expressApp.post("/gha/runner", async (req, res) => {
    const header = req.headers.authorization;
    if (header) {
        try {
            const { token } = await ciApp.validateAndGetGHAToken(header);
            return res.json({ token });
        } catch (err) {
            console.trace(err);
            return res.status(500).send();
        }

    }
    console.error("Received an invalid request with no auth header!")
    return res.status(403).send();
});

expressApp.listen(process.env.PORT || 5050, async () => {
    console.log(`Listening`);
    await ciApp.initializeApp();
    /*for(let i=0;i<1;i++){
    ciApp.launchBuildJob({
        owner: 'jon-bell',
        repositoryName: 'confetti-action-dev',
        repositoryURL: 'https://github.com/jon-bell/confetti-action-dev',
        labels: ['self-hosted.24gb']
    })
    }*/
});

setInterval(() => {
    ciApp.updateInflux();
    console.log("Updated Influx");
}, 60000);
