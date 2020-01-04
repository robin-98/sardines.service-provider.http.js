/**
 * @author Robin Sun
 * @email robin@naturewake.com
 * @create date 2019-06-13 15:43:12
 * @modify date 2019-06-13 15:43:12
 * @desc [description]
 */
import { Http, utils } from 'sardines-core'

import * as Koa from 'koa'
import * as formidable from 'formidable'
import * as Cors from 'koa2-cors'
import * as Router from 'koa-router'

// koa2-formidable
const bodyParser = function (opt?: { [key: string]: any }) {
    return async function(ctx: any, next: any){
        const form = <{[key: string]: any}>(new formidable.IncomingForm())
        for(const key in opt){
            form[key] = opt[key]
        }
        await new Promise((reslove,reject) => {
            form.parse(ctx.req,(err: any,fields: any,files: any) => {
                if (err) {
                    reject(err)
                }else {
                    ctx.request.body = fields
                    ctx.request.files = files
                    reslove()
                }
            })
        })
        await next()
    }
}

// Interfaces and helper functions for initialization of the server
export interface KoaMiddleWare {
    (ctx?: any, next?: KoaMiddleWare): Promise<any>
}
interface KoaServer {
    use: (middleware: KoaMiddleWare) => any
}

export interface HttpServiceProviderErrorCacher {
    (error: any, ctx: any, statusCode?: number|string): void
}

export interface HttpServiceProviderCorsSettings {
    credentials?: boolean
    [key: string]: any
}
export interface HttpServiceProviderBodyParserSettings {
    formLimit?: string
    jsonLimit?: string
    textLimit?: string
}
export interface HttpServiceProviderHttpHeaders {
    [key: string]: string|number
}
export interface HttpServiceProviderSettings {
    host?: string
    port?: number
    protocol?: Http.Protocol
    root?: string
    bodyParser?: HttpServiceProviderBodyParserSettings|KoaMiddleWare
    safeGuard?: boolean|KoaMiddleWare
    cors?: HttpServiceProviderCorsSettings
    syslog?: boolean|KoaMiddleWare
    public?: Http.ServiceProviderPublicInfo
    catcher?: HttpServiceProviderErrorCacher
    headers?: HttpServiceProviderHttpHeaders
    middlewares?: KoaMiddleWare[]
    postProcesses?: KoaMiddleWare[]
}


export const defaultSettings: HttpServiceProviderSettings = {
    host: '0.0.0.0',
    port: 80,
    protocol: Http.Protocol.HTTP,
    root: '/',
    bodyParser: {
        formLimit: '10mb',
        jsonLimit: '10mb',
        textLimit: '10mb',
    },
    safeGuard: true,
    cors: {
        credentials: true,
    },
    syslog: true,
    public: {
        protocol: Http.Protocol.HTTP,
        host: '127.0.0.1',
        root: '/',
        port: 80,
    },
    catcher: async (err, ctx, statusCode) => {
        ctx.status = statusCode || 200
        ctx.body = utils.unifyErrMesg(err, 'service provider', 'server wide error catcher')
    },
}

export const validatePath = (path?: string): string => {
    if (!path) return '/'
    if (path[0] !== '/') return `/${path}`
    return path
}

const validateRoot = (rootPath?: string): string => {
    let result = validatePath(rootPath)
    result = result.replace(/\/+/g, '/').replace(/[\*|:]+/g, '')
    if (result.length > 1 && result[result.length - 1] === '/') {
        result = result.substr(0, result.length - 1)
    }
    return result
}

// The provider class
export class HttpServiceProviderServer  {
    private publicInfoStr?: string
    private errorMessageHeader?: string
    
    protected serverSettings: HttpServiceProviderSettings
    protected server?: any
    protected router?: any

    constructor (settings: HttpServiceProviderSettings) {
        const tmpDefualtSettings = Object.assign({}, defaultSettings)
        const serverSettings = utils.mergeObjects(tmpDefualtSettings, settings)
        for (let item of ['port', 'protocol']) {
            serverSettings.public[item] = (settings.public || {})[item] || serverSettings[item]
        }
        serverSettings.root = validateRoot(serverSettings.root)
        serverSettings.public.root = validateRoot(serverSettings.public.root)
        serverSettings.public.host = (settings.public || {}).host || '127.0.0.1'
        this.serverSettings = serverSettings
    }

    // public properties
    get info(): Http.ServiceProviderPublicInfo {
        return this.serverSettings.public!
    }

    get infoStr(): string {
        if (this.publicInfoStr) return this.publicInfoStr

        let infoStr = ''
        const infoObj = this.info
        if (infoObj.protocol) infoStr = `${infoObj.protocol.toUpperCase()}://`
        if (infoObj.host) infoStr += infoObj.host
        if (infoObj.port) infoStr += `:${infoObj.port}`
        if (infoObj.root && infoObj.root !== '/') infoStr += infoObj.port

        this.publicInfoStr = infoStr
        return infoStr
    }

    // Properties for initialization of the server
    protected get logMesgHeader(): string {
        if (!this.errorMessageHeader) this.errorMessageHeader = `[HTTP Service Provider][${this.infoStr}`
        return this.errorMessageHeader
    }

    private applySafeGuard(server: KoaServer) {
        if (this.serverSettings.safeGuard === true) {
            server.use(async (ctx, next) => {
                try {
                    if (next) {
                        await next()
                    }
                } catch (e) {
                    utils.inspectedDebugLog(`${this.logMesgHeader} Safe guard catched ERROR`, e)
                    if (typeof this.serverSettings.catcher === 'function') {
                        try {
                            await this.serverSettings.catcher(utils.unifyErrMesg(e, 'service provider', 'server wide error catcher'), ctx)
                        } catch (err) {
                            utils.inspectedDebugLog(`${this.logMesgHeader} ERROR in custom cacher`, e)
                        }
                    }
                }
            })
            utils.debugLog(`${this.logMesgHeader} Using default safe guard`)
        } else if (typeof this.serverSettings.safeGuard === 'function') {
            this.server.use(this.serverSettings.safeGuard)
            utils.debugLog(`${this.logMesgHeader} Using custom safe guard`)
        }
    }

    private applyCORS(server: KoaServer) {
        if (this.serverSettings.cors) {
            server.use(<KoaMiddleWare>Cors(this.serverSettings.cors))
            utils.debugLog(`${this.logMesgHeader} Using CORS`)
        }
    }

    private applyHeaders(server: KoaServer) {
        if (!this.serverSettings.headers) return
        server.use(async (ctx, next) => {
            for (let prop in this.serverSettings.headers) {
                ctx.set(prop, this.serverSettings.headers[prop])
            }
            utils.debugLog(`${this.logMesgHeader} set custom headers`)
            if (next) {
                await next()
            }
        })
    }

    private applySysLogger(server: KoaServer) {
        if (this.serverSettings.syslog === true) {
            server.use(async (ctx, next) => {
                if (next) {
                    const start = Date.now()
                    await next()
                    const ms = Date.now() - start
                    utils.debugLog(`[${ctx.method}] - ${ms}ms ${ctx.url}`)
                }
            })
            utils.debugLog(`${this.logMesgHeader} Using default syslog`)
        } else if (this.serverSettings.syslog) {
            server.use(this.serverSettings.syslog)
            utils.debugLog(`${this.logMesgHeader} Using custom syslog`)
        }
    }

    private applyBodyParser(server: KoaServer) {
        if (this.serverSettings.bodyParser) {
            server.use(bodyParser(this.serverSettings.bodyParser))
            utils.debugLog(`${this.logMesgHeader} Using body parser`)
        }
    }

    private applyMiddlewares(server: KoaServer) {
        if (this.serverSettings.middlewares) {
            for (let item of this.serverSettings.middlewares) {
                server.use(item);
            }
            utils.debugLog(`${this.logMesgHeader} Using middlewares`)
        }
    }

    private applyPostProcesses(server: KoaServer) {
        if (this.serverSettings.postProcesses) {
            for (let item of this.serverSettings.postProcesses) {
                server.use(item);
            }
            utils.debugLog(`${this.logMesgHeader} Using post processes`)
        }
    }

    // initialization of the server
    init() {
        const self = this
        return new Promise((resolve, reject) => {
            if (self.server) return resolve(self.info)
            try {
                const server = new Koa()
                self.applySafeGuard(server)
                self.applyCORS(server)
                self.applyHeaders(server)
                self.applySysLogger(server)
                self.applyBodyParser(server)
                self.applyMiddlewares(server)
                self.applyPostProcesses(server)

                const router = new Router()
                server.use(<KoaMiddleWare>router.routes())
                server.use(<KoaMiddleWare>router.allowedMethods())

                try {
                    self.server = server.listen(self.serverSettings.port, self.serverSettings.host)
                } catch (e) {
                    console.error(`[service provider http] Error while trying to create listener on ${self.serverSettings.host}:${self.serverSettings.port}`)
                }
                self.router = router
                utils.debugLog(`${self.logMesgHeader} ${self.serverSettings.protocol} server is listening: ${self.serverSettings.port}: ${self.serverSettings.host}`)
                resolve(self.info)
            } catch (err) {
                const errMsg = `[Service Provider][${self.infoStr}] Error when init`
                utils.debugLog(errMsg, err)
                reject(errMsg)
            }
        })
    }
}
