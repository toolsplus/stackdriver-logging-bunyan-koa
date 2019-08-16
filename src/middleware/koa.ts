/*
 * Adapted from:
 * https://github.com/googleapis/nodejs-logging-bunyan/blob/master/src/middleware/express.ts
 */
import * as bunyan from "bunyan";
import {GCPEnv} from "google-auth-library";
import {HttpRequest} from "@google-cloud/logging";
import {LOGGING_TRACE_KEY, LoggingBunyan} from "@google-cloud/logging-bunyan";
import * as types from "@google-cloud/logging-bunyan/build/src/types/core";
import {AnnotatedContextType, makeMiddleware} from "./make-middleware";
import * as Koa from "koa";
import {ParameterizedContext} from "koa";

export const APP_LOG_SUFFIX = "applog";
export type Logger = ReturnType<typeof bunyan.createLogger>;

export interface MiddlewareOptions extends types.Options {
    level?: types.LogLevel | number;
}

export interface MiddlewareReturnType {
    logger: Logger;
    mw: Koa.Middleware<any, ParameterizedContext<AnnotatedContextType<Logger>>>;
}

/**
 * Koa middleware
 */
export async function middleware(
    options?: MiddlewareOptions
): Promise<MiddlewareReturnType> {
    const defaultOptions: MiddlewareOptions = {logName: "bunyan_log", level: "info"};
    options = {...defaultOptions, ...options};

    const loggingBunyanApp = new LoggingBunyan({
        ...options,
        // For request bundling to work, the parent (request) and child (app) logs
        // need to have distinct names. For exact requirements see:
        // https://cloud.google.com/appengine/articles/logging#linking_app_logs_and_requests
        logName: `${options.logName}_${APP_LOG_SUFFIX}`
    });
    const logger = bunyan.createLogger({
        name: `${options.logName}_${APP_LOG_SUFFIX}`,
        streams: [loggingBunyanApp.stream(options.level as types.LogLevel)]
    });

    const auth = loggingBunyanApp.stackdriverLog.logging.auth;
    const [env, projectId] = await Promise.all([
        auth.getEnv(),
        auth.getProjectId()
    ]);

    // Unless we are running on Google App Engine or Cloud Functions, generate a
    // parent request log entry that all the request-specific logs ("app logs")
    // will nest under. GAE and GCF generate the parent request logs
    // automatically.
    let emitRequestLog;
    if (env !== GCPEnv.APP_ENGINE && env !== GCPEnv.CLOUD_FUNCTIONS) {
        const loggingBunyanReq = new LoggingBunyan(options);
        const requestLogger = bunyan.createLogger({
            name: options.logName!,
            streams: [loggingBunyanReq.stream(options.level as types.LogLevel)]
        });
        emitRequestLog = (httpRequest: HttpRequest, trace: string) => {
            requestLogger.info({[LOGGING_TRACE_KEY]: trace, httpRequest});
        };
    }

    return {
        logger,
        mw: makeMiddleware(
            projectId,
            makeChildLogger,
            emitRequestLog
        )
    };

    function makeChildLogger(trace: string) {
        return logger.child({[LOGGING_TRACE_KEY]: trace}, true);
    }
}
