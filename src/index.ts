import * as Http from './service'
export * from './service'

export class HttpServiceProvider extends Http.HttpServiceProviderService {
    constructor(serverSettings: Http.HttpServiceProviderSettings) {
        super(serverSettings)
    }
}

console.log('type of http:', typeof Http.Protocol.HTTP, ', value of http:', Http.Protocol.HTTP)
