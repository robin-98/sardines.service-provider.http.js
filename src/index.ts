/**
 * @author Robin Sun
 * @email robin@naturewake.com
 * @create date 2019-06-13 15:43:17
 * @modify date 2019-06-13 15:43:17
 * @desc [description]
 */
import * as Server from './server'
import * as utils from 'sardines-utils'
import { Http, Sardines } from 'sardines-utils'
import * as KoaSend from 'koa-send'
import * as fs from 'fs'

// Enums for service settings
export const defaultHttpServiceSettings: Http.ServiceSettings = {
    protocol: Http.Protocol.HTTP,
    path: '/',
    method: Http.Method.POST,
    inputParameters: [{
            position: Http.ServiceInputParamPosition.body,
            type: Http.ServiceInputParamType.object
    }],
    middlewares: [],
    postProcesses: [],
    response: {
        type: Http.ServiceResponseType.json
    }
}

// Helper functions for registering services on the server
export const summaryServiceSettings = (serviceSettings: Http.ServiceSettings): string => {
    return `${serviceSettings.protocol!.toUpperCase()}@${serviceSettings.method!}:${serviceSettings.path!}`
}

const joinPath = (root: string, servicePath?: string): string => {
    return `${root}${Server.validatePath(servicePath)}`.replace(/\/+/g, '/')
}

const unifyHttpServiceSettings = (originalServiceSettings: Http.ServiceSettings, serverSettings: Server.HttpServiceProviderSettings): Http.ServiceSettings|string => {
    let serviceSettings = Object.assign({}, originalServiceSettings)
    if (!serviceSettings.protocol) serviceSettings.protocol = Http.Protocol.HTTP
    if (!serviceSettings.method) serviceSettings.method = Http.Method.POST
    if (!serviceSettings.response) serviceSettings.response = {type: Http.ServiceResponseType.json}
    if (!serviceSettings.response.type) serviceSettings.response.type = Http.ServiceResponseType.json

    // Unifying
    serviceSettings.protocol = Http.Protocol[serviceSettings.protocol!.toUpperCase() as keyof typeof Http.Protocol]
    serviceSettings.method = Http.Method[serviceSettings.method!.toUpperCase() as keyof typeof Http.Method]
    serviceSettings.response!.type = Http.ServiceResponseType[serviceSettings.response!.type.toLowerCase() as keyof typeof Http.ServiceResponseType]
    if (!serviceSettings.response.type) {
        serviceSettings.response.type = Http.ServiceResponseType.json 
    }

    serviceSettings.path = joinPath(serverSettings.root!, serviceSettings.path)
    if (serviceSettings.response!.type === Http.ServiceResponseType.static || serviceSettings.response!.type === Http.ServiceResponseType.file) {
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
        if (paramDef.position) {
            paramDef.position = Http.ServiceInputParamPosition[paramDef.position.toLowerCase() as keyof typeof Http.ServiceInputParamPosition]
        }
        if (!paramDef.position) {
            paramDef.position = Http.ServiceInputParamPosition.body
        }
        if (paramDef.type) {
            paramDef.type = Http.ServiceInputParamType[paramDef.type.toLowerCase() as keyof typeof Http.ServiceInputParamType]
        }
        if (!paramDef.type) {
            paramDef.type = Http.ServiceInputParamType.object
        }
        if (typeof paramDef.name === 'undefined') {
            paramDef.name = ''
        }
    }
    const serviceSummary = summaryServiceSettings(serviceSettings)
    serviceSettings.summary = serviceSummary

    // Validation
    if (!(serviceSettings.protocol!.toUpperCase() in Http.Protocol)) {
        return `Invalid protocol <${serviceSettings.protocol}> for registering service [${serviceSummary}]`
    }
    if (!(serviceSettings.method!.toUpperCase() in Http.Method)) {
        return `Invalid method <${serviceSettings.method}> for registering service [${serviceSummary}]`
    }

    return serviceSettings;
}

const unifyServiceSettings = (service: Sardines.Service, serverSettings: Server.HttpServiceProviderSettings, additionalSettings: any, handler: any): Http.ServiceSettings|string => {
    let httpService: any = {}
    let serviceId = `${service.module}/${service.name}`
    if (additionalSettings && additionalSettings.path) httpService.path = additionalSettings.path
    else httpService.path = serviceId 
    httpService.protocol = serverSettings.protocol
    if (additionalSettings && additionalSettings.method) httpService.method
    else httpService.method = Http.Method.POST

    if (additionalSettings.inputParameters) httpService.inputParameters = additionalSettings.inputParameters
    else if (service.arguments && Array.isArray(service.arguments) && service.arguments.length > 0) {
        for (let arg of service.arguments) {
            if (!httpService.inputParameters) httpService.inputParameters = []
            
            httpService.inputParameters.push(arg)
        }
    }

    if (additionalSettings.response) httpService.response = additionalSettings.response
    else if (service.returnType) {
        httpService.response = {type: service.returnType}
    }
    if (handler) httpService.handler = handler

    return unifyHttpServiceSettings(httpService, serverSettings)
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
const extractParams = (ctx: any, paramDef?: Http.ServiceInputParameter[]): Promise<any> => {
    return new Promise((resolve, reject) => {
        const parameters: Http.ServiceInputParameter|null[] = [];
        const pd = paramDef || [{ position: Http.ServiceInputParamPosition.body, type: Http.ServiceInputParamType.object, name: '' }];
        if (pd && Array.isArray(pd) && pd.length > 0) {
            pd.forEach((p) => {
                if (typeof p === 'object' && p.position && (typeof p.name === 'string' || p.name === undefined)) {
                    const param = Object.assign({}, { position: 'body', type: 'object', name: '' }, p);
                    switch (param.position) {
                        case Http.ServiceInputParamPosition.ctx:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx);
                        } else {
                            parameters.push(ctx[param.name]);
                        }
                        break;

                        case Http.ServiceInputParamPosition.session:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.session);
                        } else if (ctx.session && typeof ctx.session === 'object') {
                            parameters.push(ctx.session[param.name]);
                        } else {
                            parameters.push(null);
                        }
                        break;

                        case Http.ServiceInputParamPosition.body:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.body);
                        } else {
                            parameters.push(ctx.request.body[param.name]);
                        }
                        break;
                        
                        case Http.ServiceInputParamPosition.files:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.files);
                        } else {
                            parameters.push(ctx.request.files[param.name]);
                        }
                        break;
                        
                        case Http.ServiceInputParamPosition.header:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.header);
                        } else {
                            parameters.push(ctx.request.header[param.name]);
                        }
                        break;
                        
                        case Http.ServiceInputParamPosition.query:
                        if (param.name === undefined || param.name === '') {
                            parameters.push(ctx.request.query);
                        } else {
                            parameters.push(ctx.request.query[param.name]);
                        }
                        break;

                        case Http.ServiceInputParamPosition.cookies:
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
export default class HttpServiceProvider extends Server.HttpServiceProviderServer {
    constructor(serverSettings: Server.HttpServiceProviderSettings) {
        super(serverSettings)
    }

    registerService(originalServiceSettings: Http.ServiceSettings|Sardines.Service, additionalSettings:any = null, handler: any = null): Promise<any> {
        // Unify the service settings
        let unifiedServiceSettings: Http.ServiceSettings|string|null = null
        if ('path' in originalServiceSettings) {
            unifiedServiceSettings = unifyHttpServiceSettings(originalServiceSettings, this.serverSettings)
        } else {
            unifiedServiceSettings = unifyServiceSettings(<Sardines.Service>originalServiceSettings, this.serverSettings, additionalSettings, handler)
        }
        
        if (!unifiedServiceSettings || typeof unifiedServiceSettings === 'string') {
            return Promise.reject(unifiedServiceSettings)
        }
        let serviceSettings: Http.ServiceSettings = unifiedServiceSettings
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
                    const error = utils.unifyErrMesg(err, 'service provider', stage);
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
                case Http.ServiceResponseType.text: case Http.ServiceResponseType.string:
                ctx.body = res;
                break;

                case Http.ServiceResponseType.json:
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
                        case Http.ServiceResponseType.static: case Http.ServiceResponseType.file:
                        self.router[serviceSettings.method!](serviceSettings.path, async(ctx:any , next: any) => {
                            const filePath = (serviceSettings.path!.length > 2) ? ctx.path.substr(serviceSettings.path!.length - 2) : ctx.path
                            await processService(async () => await sendStaticFile(filePath, ctx), ctx, next)
                        })
                        break

                        case Http.ServiceResponseType.html: case Http.ServiceResponseType.render:
                        self.router[serviceSettings.method!](serviceSettings.path, async(ctx:any, next: any) => {
                            await processService(async () => await sendText(ctx), ctx, next)
                        })
                        break

                        case Http.ServiceResponseType.handler:
                        self.router[serviceSettings.method!](serviceSettings.path, async(ctx:any, next: any) => {
                            await processService(async () => await serviceSettings.handler(ctx), ctx, next)
                        })
                        break

                        case Http.ServiceResponseType.json: case Http.ServiceResponseType.string: case Http.ServiceResponseType.text:
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
