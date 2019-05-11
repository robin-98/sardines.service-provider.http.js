import * as Http from './server'
import * as utils from 'sardines-utils'
import * as KoaSend from 'koa-send'
import * as fs from 'fs'

// Enums for service settings
export enum HttpServiceInputParamPosition {
    body = 'body',
    ctx = 'ctx',
    session = 'session',
    files = 'files',
    header = 'header',
    query = 'query',
    cookies = 'cookies',

}

export enum HttpServiceInputParamType {
    object = 'object'
}

export enum HttpServiceMethod {
    GET = 'get',
    PUT = 'put',
    POST = 'post', 
    HEADER = 'header',
    OPTIONS = 'options',
    DEL = 'del',
    DELETE = 'delete'
}

export enum HttpServiceResponseType {
    static = 'static',
    file = 'file',
    html = 'html',
    render = 'render',
    handler = 'handler',
    JSON = 'json',
    text = 'text',
    string = 'string'
}

// Interfaces for the service settings 
export interface HttpServiceResponse {
    type: HttpServiceResponseType
    path?: string|any[]
}

export interface HttpServiceInputParameter {
    position: HttpServiceInputParamPosition
    type?: HttpServiceInputParamType
    name?: string
}

export interface HttpServiceSettings {
    protocol?: Http.Protocol
    path?: string
    method?: HttpServiceMethod
    handler?: any
    inputParameters?: HttpServiceInputParameter[]
    response?: HttpServiceResponse
    middlewares?: any[]
    postProcesses?: any[]
    summary?: string
}

export const defaultHttpServiceSettings: HttpServiceSettings = {
    protocol: Http.Protocol.HTTP,
    path: '/',
    method: HttpServiceMethod.POST,
    inputParameters: [{
            position: HttpServiceInputParamPosition.body,
            type: HttpServiceInputParamType.object
    }],
    middlewares: [],
    postProcesses: [],
    response: {
        type: HttpServiceResponseType.JSON
    }
}

// Helper functions for registering services on the server
export const summaryServiceSettings = (serviceSettings: HttpServiceSettings): string => {
    return `${serviceSettings.protocol!.toUpperCase()}@${serviceSettings.method!}:${serviceSettings.path!}`
}

const joinPath = (root: string, servicePath?: string): string => {
    return `${root}${Http.validatePath(servicePath)}`.replace(/\/+/g, '/')
}

const unifyServiceSettings = (serviceSettings: HttpServiceSettings, serverSettings: Http.HttpServiceProviderSettings): HttpServiceSettings|string => {
    const serviceSummary = summaryServiceSettings(serviceSettings)
    serviceSettings.summary = serviceSummary
    // Validation
    if (!(serviceSettings.protocol!.toLocaleLowerCase() in Http.Protocol)) {
        return `Invalid protocol <${serviceSettings.protocol}> for registering service [${serviceSummary}]`
    }
    if (!(serviceSettings.method!.toLocaleLowerCase() in HttpServiceMethod)) {
        return `Invalid method <${serviceSettings.method}> for registering service [${serviceSummary}]`
    }
    // Unifying
    serviceSettings.protocol = Http.Protocol[serviceSettings.protocol!.toLocaleLowerCase() as keyof typeof Http.Protocol]
    serviceSettings.method = HttpServiceMethod[serviceSettings.method!.toLocaleLowerCase() as keyof typeof HttpServiceMethod]
    serviceSettings.response!.type = HttpServiceResponseType[serviceSettings.response!.type.toLocaleLowerCase() as keyof typeof HttpServiceResponseType]
    serviceSettings.path = joinPath(serverSettings.root!, serviceSettings.path)
    if (serviceSettings.response!.type === HttpServiceResponseType.static || serviceSettings.response!.type === HttpServiceResponseType.file) {
        if (!(serviceSettings.response!.path)) {
            serviceSettings.response!.path = './'
        }
        if (serviceSettings.path[serviceSettings.path.length - 1] !== '*') {
            if (serviceSettings.path[serviceSettings.path.length - 1] !== '/') {
                serviceSettings.path += '/';
            }
            serviceSettings.path += '*';
        }
    }
    // Unifying input parameters
    for (let paramDef of serviceSettings.inputParameters!) {
        paramDef.position = HttpServiceInputParamPosition[paramDef.position.toLocaleLowerCase() as keyof typeof HttpServiceInputParamPosition]
        if (paramDef.type) {
            paramDef.type = HttpServiceInputParamType[paramDef.type.toLocaleLowerCase() as keyof typeof HttpServiceInputParamType]
        }
        if (typeof paramDef.name === 'undefined') {
            paramDef.name = ''
        }
    }

    return serviceSettings;
}

const readFile = (filepath: string): Promise<any> => (
    new Promise((rfRes, rfRej) => {
        fs.readFile(filepath, { encoding: 'utf8' }, (err, data) => {
            if (err) {
                rfRej({ status: 404, message: `File not found: ${filepath}` });
            } else {
                rfRes(data);
            }
        });
    })
);

// parameter extractor
// Extract parameters = require(request according to their definition
const extractParams = (ctx: any, paramDef?: HttpServiceInputParameter[]): Promise<any> => {
    return new Promise((resolve, reject) => {
        const parameters: HttpServiceInputParameter|null[] = [];
        const pd = paramDef || [{ position: HttpServiceInputParamPosition.body, type: HttpServiceInputParamType.object, name: '' }];
        if (pd && Array.isArray(pd) && pd.length > 0) {
            pd.forEach((p) => {
                if (typeof p === 'object' && p.position && (typeof p.name === 'string' || p.name === undefined)) {
                    const param = Object.assign({}, { position: 'body', type: 'object', name: '' }, p);
                    switch (param.position) {
                        case HttpServiceInputParamPosition.ctx:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx);
                        } else {
                            parameters.push(ctx[param.name]);
                        }
                        break;

                        case HttpServiceInputParamPosition.session:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.session);
                        } else if (ctx.session && typeof ctx.session === 'object') {
                            parameters.push(ctx.session[param.name]);
                        } else {
                            parameters.push(null);
                        }
                        break;

                        case HttpServiceInputParamPosition.body:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.body);
                        } else {
                            parameters.push(ctx.request.body[param.name]);
                        }
                        break;
                        
                        case HttpServiceInputParamPosition.files:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.files);
                        } else {
                            parameters.push(ctx.request.files[param.name]);
                        }
                        break;
                        
                        case HttpServiceInputParamPosition.header:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.header);
                        } else {
                            parameters.push(ctx.request.header[param.name]);
                        }
                        break;
                        
                        case HttpServiceInputParamPosition.query:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.query);
                        } else {
                            parameters.push(ctx.request.query[param.name]);
                        }
                        break;

                        case HttpServiceInputParamPosition.cookies:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.cookies);
                        } else {
                            parameters.push(ctx.cookies.get(param.name));
                        }
                        break;
                        
                        default:
                        reject(`Unsupported parameter position: ${param.position}`);
                        break;
                    }
                } else {
                    reject('Parameter definition format error');
                }
            });
        } 
        resolve(parameters);
    });
}

// The class of HttpServiceProviderService
export class HttpServiceProviderService extends Http.HttpServiceProviderServer {
    constructor(serverSettings: Http.HttpServiceProviderSettings) {
        super(serverSettings)
    }

    registerService(originalServiceSettings: HttpServiceSettings): Promise<any> {
        // Unify the service settings
        const serviceSettings = unifyServiceSettings(originalServiceSettings, this.serverSettings)
        if (typeof serviceSettings === 'string') {
            return Promise.reject(serviceSettings)
        }

        // The process of a service
        const processService = async (serviceHandler: any, ctx: any, next: any) => {
            for (let stage of ['service custom middlewares', 'service handler', 'service custom post proprecesses']) {
                try {
                    switch (stage) {
                        case 'service custom middlewares':
                        const middlewareHandler = utils.chainFunctions(serviceSettings.middlewares!, ctx);
                        if (middlewareHandler) {
                            await middlewareHandler();
                        }
                        break

                        case 'service handler':
                        await serviceHandler();
                        break

                        case 'service custom post proprecesses':
                        const postProcessesHandler = utils.chainFunctions(serviceSettings.postProcesses!, ctx);
                        if (postProcessesHandler) {
                            await postProcessesHandler();
                        }
                        break

                        default:
                        break
                        
                    }
                } catch (err) {
                    utils.inspectedDebugLog(`${this.logMesgHeader} Error when executing <${stage}> for service [${serviceSettings.summary!}]`, err);
                    const error = utils.unifyErrMesg(err, stage);
                    if (typeof this.serverSettings.catcher === 'function') {
                        await this.serverSettings.catcher(error, ctx);
                    } else throw error;
                }
            }
            await next()
        };

        // Send a file like downloading an image
        const sendStaticFile = async (filePath: string, ctx: any) => {
            utils.debugLog(`${this.logMesgHeader} going to send static file: ${filePath}`)
            let done: string|null = null
            try {
                done = await KoaSend(ctx, filePath, {root: <string>serviceSettings.response!.path!})
            } catch(err) {
                if (err.status !== 404) {
                    utils.inspectedDebugLog(`${this.logMesgHeader} Error when sending static file <${filePath}>`, err);
                }
            } finally {
                if (done) {
                    utils.debugLog(`${this.logMesgHeader} sent static file <${filePath}> with return code: ${done}`)
                }
            }
        }

        // Send file content as string, like rendering html file
        const sendText = async (ctx: any) => {
            ctx.set('content-type', 'text/html')
            if (typeof serviceSettings.response!.path === 'string') {
                ctx.body = await readFile(serviceSettings.response!.path);
            } else if (Array.isArray(serviceSettings.response!.path) && serviceSettings.response!.path.length > 0) {
                // Render html page according to conditions
                let rendered = false;
                for (const pair of serviceSettings.response!.path) {
                    if (typeof pair.selector === 'function' && typeof pair.path === 'string') {
                        const match = await pair.selector(ctx);
                        if (match) {
                            rendered = true;
                            ctx.body = await readFile(pair.path);
                            break;
                        }
                    }
                }
                if (!rendered) {

                }
            }
        }

        // User custom service handler
        const execCustomService = async(ctx: any) => {
            const params = await extractParams(ctx, serviceSettings.inputParameters!);
            utils.inspectedDebugLog(`${this.logMesgHeader} extracted input from invocation`, params);
            let res = await serviceSettings.handler!(...params);
            switch (serviceSettings.response!.type) {
                case HttpServiceResponseType.text: case HttpServiceResponseType.string:
                ctx.body = res;
                break;

                case HttpServiceResponseType.JSON:
                default: // JSON
                if (typeof res !== 'object' || res === null) res = { res };
                ctx.body = res;
                break;
            }
        }

        // registering the service on http server
        const self = this        
        return new Promise((resolve, reject) => {
            self.init().then((/* public server info is not useful here */) => {
                try {
                    switch (serviceSettings.response!.type) {
                        case HttpServiceResponseType.static: case HttpServiceResponseType.file:
                        self.router[serviceSettings.method!](serviceSettings.path, async(ctx:any , next: any) => {
                            const filePath = (serviceSettings.path!.length > 2) ? ctx.path.substr(serviceSettings.path!.length - 2) : ctx.path
                            await processService(async () => await sendStaticFile(filePath, ctx), ctx, next)
                        })
                        break

                        case HttpServiceResponseType.html: case HttpServiceResponseType.render:
                        self.router[serviceSettings.method!](serviceSettings.path, async(ctx:any, next: any) => {
                            await processService(async () => await sendText(ctx), ctx, next)
                        })
                        break

                        case HttpServiceResponseType.handler:
                        self.router[serviceSettings.method!](serviceSettings.path, async(ctx:any, next: any) => {
                            await processService(async () => await serviceSettings.handler(ctx), ctx, next)
                        })
                        break

                        case HttpServiceResponseType.JSON: case HttpServiceResponseType.string: case HttpServiceResponseType.text:
                        default:
                        self.router[serviceSettings.method!](serviceSettings.path, async(ctx:any, next: any) => {
                            await processService(async () => await execCustomService(ctx), ctx, next)
                        })
                        break
                    }
                    utils.debugLog(`${self.logMesgHeader} successfully registered service [${serviceSettings.summary!}] on path [${serviceSettings.path!}]`)
                    return resolve(serviceSettings)
                } catch (err) {
                    utils.inspectedDebugLog(`${self.logMesgHeader} failed to register service [${serviceSettings.summary!}] on path [${serviceSettings.path!}]`, err)
                    return reject(err)
                }
            })
        })
    }
}

export * from './server'
