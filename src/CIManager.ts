import { App } from '@octokit/app';
import { createAppAuth } from '@octokit/auth-app';
import * as dotenv from 'dotenv';
import { Octokit } from '@octokit/core';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as jwt from 'jsonwebtoken';
import YAML from 'yaml';
import { createClient, RedisClusterOptions } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { InfluxDB, Point } from '@influxdata/influxdb-client';

dotenv.config();

type OrganizationConfiguration = {
    login: string;
    url: string;
    events_url: string;
    repos: RepoConfiguration[];
    runner_config?: RunnerConfiguration[];
    slurm_cluster_configs: SlurmSpec[];
}
type NodeSpec = {
    partition: string;
    duration: string;
    cpus: string;
    memory: string;
}
type SlurmSpec = {
    type: "slurmrestd" | "local";
    address: string;
    jwt_token: string;
}
type RunnerConfiguration = {
    label: string;
    slurm_cluster_config: string;
    node_spec: NodeSpec;
}
type RepoConfiguration = {
    name: string;
}
type AppConfiguration = {
    organizations: OrganizationConfiguration[];
}
type GHWorkerBatchRequest = {
    gitHubURL: string;
    launcherToken: string;
    runnerLabels?: string;
    tokenURL: string;
}
type TokenCache = {
    repoURL: string;
    token: Promise<string>;
    expiresAt: number;
}
type LauncherState = {
    owner: string,
    repositoryName: string,
    repositoryURL: string,
    labels: string[],
    workflowId: number
}

// You can generate an API token from the "API Tokens Tab" in the UI
const url = process.env.INFLUX_URL || '';
const token = process.env.INFLUX_TOKEN || '';
const org = process.env.INFLUX_ORG || '';
const bucket = process.env.INFLUX_BUCKET || '';

export default class CIManager {
    private _app: App;
    private static _instance: CIManager;
    private _config: AppConfiguration;
    private tokenCache: TokenCache[] = [];
    private _redis;
    private _jwtKey: string = "";
    private _influx: InfluxDB;

    static getInstance(app: App): CIManager {
        if (CIManager._instance === undefined) {
            CIManager._instance = new CIManager(app);
        }
        return CIManager._instance;
    }
    constructor(app: App) {
        this._app = app;
        this._config = { organizations: [] };
        this._redis = createClient();
        this._influx = new InfluxDB({ url, token });
        if (fs.existsSync("config.yml")) {
            this._config = YAML.parse(fs.readFileSync("config.yml", "utf-8")) as AppConfiguration;
        }
    }
    saveConfiguration() {
        fs.writeFileSync("config.yml",
            YAML.stringify(this._config));
    }
    async launchWorker(batchReq: GHWorkerBatchRequest) {
        if (process.env.GHA_SLURM_ADDRESS) {
            await fetch(process.env.GHA_SLURM_ADDRESS + '/runner/start', {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': "application/json",
                    'auth-token': process.env.GHA_SLURM_SHARED_SECRET || ''
                },
                method: 'POST',
                body: JSON.stringify(batchReq)
            });
        }
    }
    async validateAndGetGHAToken(ourToken: string) {
        const decoded = jwt.verify(ourToken, this._jwtKey) as LauncherState;
        // make sure that we still need to launch this runner
        const res = await this._redis.zScore(decoded.repositoryURL, decoded.workflowId.toString());
        if (!res) {
            throw "Runner token no longer valid, job cancelled";
        }
        const ghaToken = await this.startBuildJob(decoded);
        return { token: ghaToken };
    }
    async promiseForToken(octokit: Octokit, owner: string, repositoryName: string, repositoryURL: string) {
        console.log("Fetching new token for " + owner + "/" + repositoryName)
        let token = await octokit.request("POST /repos/" + owner + "/" + repositoryName + "/actions/runners/registration-token");
        console.log("Updating expiration: " + token.data.expires_at)
        const tokenCache = this.tokenCache.find(v => v.repoURL == repositoryURL);
        if (tokenCache)
            tokenCache.expiresAt = Date.parse(token.data.expires_at);
        return token.data.token;
    }
    async startBuildJob(req: LauncherState) {
        const orgInstallationOctokit = this._installations.find(v => v.orgName == req.owner)?.octokit;
        if (!orgInstallationOctokit) {
            console.log("No app installation found for org " + req.owner);
            return;
        }
        let tokenCache = this.tokenCache.find(v => v.repoURL == req.repositoryURL);
        if (!tokenCache) {
            tokenCache = { repoURL: req.repositoryURL, token: this.promiseForToken(orgInstallationOctokit, req.owner, req.repositoryName, req.repositoryURL), expiresAt: Date.now() + 3600 }
            this.tokenCache.push(tokenCache);
        }
        if (Date.now() > tokenCache.expiresAt) {
            console.log("Now: " + Date.now() + ", expired: " + tokenCache.expiresAt)
            tokenCache.token = this.promiseForToken(orgInstallationOctokit, req.owner, req.repositoryName, req.repositoryURL);
        }
        return await tokenCache.token;
    }
    async launchBuildJob(req: LauncherState) {
        const orgInstallationOctokit = this._installations.find(v => v.orgName == req.owner)?.octokit;
        if (!orgInstallationOctokit) {
            console.log("No app installation found for org " + req.owner);
            return;
        }
        const launcherToken = await jwt.sign(req, this._jwtKey);
        await this._redis.zAdd(req.repositoryURL, { score: Date.now(), value: req.workflowId.toString() });
        this.launchWorker({
            gitHubURL: req.repositoryURL,
            launcherToken: launcherToken,
            runnerLabels: req.labels.join(','),
            tokenURL: process.env.RUNNER_URL || '',
        })
    }
    async removeBuildJob(req: LauncherState) {
        return await this._redis.zRem(req.repositoryURL, req.workflowId.toString());
    }
    async checkInstalled(url: string) {
        // get org name from url
        const orgName = url.split("/")[3];
        const installation = this._installations.find(v => v.orgName == orgName);
        if (installation) {
            const repos = await installation.octokit.request("GET /installation/repositories");
            if (repos.data.repositories.find(v => v.html_url == url)) {
                return true;
            }
        }
        return false;
    }
    async updateInflux() {
        const writeApi = this._influx.getWriteApi(org, bucket);
        writeApi.useDefaultTags({ host: 'host1' });

        const keys = await this._redis.keys("*");

        for (const key of keys) {
            if (!(await this._redis.type(key) === "zset")) {
                continue;
            }
            const jobs = await this._redis.zRangeWithScores(key, 0, 0);
            let numJobs = jobs.length;
            let oldestAge = 0;
            if (jobs[0]) {
                oldestAge = Date.now() - jobs[0].score;
            }
            const point = new Point('jobs').tag('repo', key).uintField("numJobs", numJobs).uintField("oldestJobAgeMinutes", Math.floor(oldestAge / 60000));
            writeApi.writePoint(point);
        }

        writeApi
            .close()
            .then(() => {
                console.log('FINISHED')
            })
    }
    async getBuilderURL(platform: "x86" | "arm") {

    }
    private _installations: { orgName: string, id: number, octokit: Octokit }[] = [];
    async initializeApp() {

        this._redis.on("error", (err) => console.log('Redis Client Error', err));
        await this._redis.connect();
        let key = await this._redis.get("jwtKey");
        if (key) {
            this._jwtKey = key;
        } else {
            const key = uuidv4();
            this._jwtKey = key;
            await this._redis.set("jwtKey", key);
        }

        const installations = await this._app.octokit.request('GET /app/installations');
        for (let installation of installations.data) {
            this._installations.push({
                orgName: installation.account?.login || '',
                id: installation.id,
                octokit: new Octokit({
                    authStrategy: createAppAuth,
                    auth: {
                        appId: process.env.APP_ID,
                        privateKey: fs.readFileSync(process.env.PRIVATE_KEY_FILE || '', 'utf8'),
                        installationId: installation.id,
                    },
                })
            });
        }

        //TODO: does this really matter?
        //TODO just delete this all, move it into the part that lives in munge domain
        for await (const { octokit, repository } of this._app.eachRepository.iterator()) {
            //Update our config map with any newly available repos
            //TODO listen for webhooks of repo creation 
            let org: OrganizationConfiguration | null = null;
            for (const each of this._config.organizations) {
                if (each.login == repository.owner.login)
                    org = each;
            }
            if (!org) {
                org = {
                    login: repository.owner.login,
                    url: repository.owner.url,
                    events_url: repository.owner.events_url,
                    repos: [], runner_config: [],
                    slurm_cluster_configs: []
                };
                this._config.organizations.push(org);
            }
            let repo = null;
            for (const each of org.repos) {
                if (each.name == each.name)
                    repo = each;
            }
            if (!repo) {
                repo = { name: repository.name };
                org.repos.push(repo);
            }
            this.saveConfiguration();
        }
        this.saveConfiguration();
    }
}