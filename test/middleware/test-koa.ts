import * as assert from "assert";
import {GCPEnv} from "google-auth-library";
import * as proxyquire from "proxyquire";

import {MiddlewareOptions} from '../../src/middleware/koa';
import * as Koa from "koa";
import {ParameterizedContext} from "koa";
import {AnnotatedContextType} from "../../src/middleware/make-middleware";

const FAKE_PROJECT_ID = "project-🦄";
const FAKE_GENERATED_MIDDLEWARE = async () => {};

const FAKE_ENVIRONMENT = "FAKE_ENVIRONMENT";

let authEnvironment: string;
let passedOptions: Array<MiddlewareOptions | undefined>;

class FakeLoggingBunyan {
    // tslint:disable-next-line:no-any Doing "just enough" faking.
    stackdriverLog: any;
    constructor(options: MiddlewareOptions) {
        passedOptions.push(options);
        this.stackdriverLog = {
            logging: {
                auth: {
                    async getProjectId() {
                        return FAKE_PROJECT_ID;
                    },
                    async getEnv() {
                        return authEnvironment;
                    },
                },
            },
        };
    }

    // tslint:disable-next-line:no-any Doing "just enough" faking.
    stream(level: any) {
        return {level, type: "raw", stream: this};
    }
}

let passedProjectId: string | undefined;
let passedEmitRequestLog: Function | undefined;
function fakeMakeMiddleware<LoggerType>(
    projectId: string,
    makeChildLogger: Function,
    emitRequestLog: Function
): Koa.Middleware<any, ParameterizedContext<AnnotatedContextType<LoggerType>>> {
    passedProjectId = projectId;
    passedEmitRequestLog = emitRequestLog;
    return FAKE_GENERATED_MIDDLEWARE;
}

const {middleware, APP_LOG_SUFFIX} = proxyquire(
    "../../src/middleware/koa",
    {
        "@google-cloud/logging-bunyan": {
            LoggingBunyan: FakeLoggingBunyan
        },
        "../../src/middleware/make-middleware": {
            makeMiddleware: fakeMakeMiddleware,
        },
    }
);

describe("middleware/koa", () => {
    beforeEach(() => {
        passedOptions = [];
        passedProjectId = undefined;
        passedEmitRequestLog = undefined;
        authEnvironment = FAKE_ENVIRONMENT;
    });

    it("should create and return a middleware", async () => {
        const {mw} = await middleware();
        assert.strictEqual(mw, FAKE_GENERATED_MIDDLEWARE);
    });

    it("should generate two loggers with default logName and level", async () => {
        await middleware();
        assert.ok(passedOptions);
        assert.strictEqual(passedOptions.length, 2);
        assert.ok(
            passedOptions.some(
                option => option!.logName === `bunyan_log_${APP_LOG_SUFFIX}`
            )
        );
        assert.ok(passedOptions.some(option => option!.logName === `bunyan_log`));
        assert.ok(passedOptions.every(option => option!.level === 'info'));
    });

    it("should prefer user-provided logName and level", async () => {
        const LOGNAME = "㏒";
        const LEVEL = "fatal";
        const OPTIONS = {logName: LOGNAME, level: LEVEL};
        await middleware(OPTIONS);
        assert.ok(passedOptions);
        assert.strictEqual(passedOptions.length, 2);
        assert.ok(
            passedOptions.some(
                option => option!.logName === `${LOGNAME}_${APP_LOG_SUFFIX}`
            )
        );
        assert.ok(passedOptions.some(option => option!.logName === LOGNAME));
        assert.ok(passedOptions.every(option => option!.level === LEVEL));
    });

    it("should acquire the projectId and pass to makeMiddleware", async () => {
        await middleware();
        assert.strictEqual(passedProjectId, FAKE_PROJECT_ID);
    });

    [GCPEnv.APP_ENGINE, GCPEnv.CLOUD_FUNCTIONS].forEach(env => {
        it(`should not generate the request logger on ${env}`, async () => {
            authEnvironment = env;
            await middleware();
            assert.ok(passedOptions);
            assert.strictEqual(passedOptions.length, 1);
            // emitRequestLog parameter to makeChildLogger should be undefined.
            assert.strictEqual(passedEmitRequestLog, undefined);
        });
    });
});
