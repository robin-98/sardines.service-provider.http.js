import * as Http from './service'
export * from './service'
import * as utils from 'sardines-utils'

export class HttpServiceProvider extends Http.HttpServiceProviderService {
    constructor(serverSettings: Http.HttpServiceProviderSettings) {
        super(serverSettings)
    }
}

console.log('type of http:', typeof utils.Http.Protocol.HTTP, ', value of http:', utils.Http.Protocol.HTTP)
