import { type IRequestTransport, type MaybePromise, TransportError } from "../../base.ts";

/**
 * Error thrown when an HTTP response is deemed invalid:
 * - Non-200 status code
 * - Unexpected content type
 */
export class HttpRequestError extends TransportError {
    /**
     * Creates a new HTTP request error.
     * @param response - The failed HTTP response.
     * @param responseBody - The raw response body content, if available.
     */
    constructor(public response: Response, public responseBody?: string) {
        let message = `HTTP request failed: status ${response.status}`;
        if (responseBody) message += `, body "${responseBody}"`;

        super(message);
        this.name = "HttpRequestError";
    }
}

/** Configuration options for the HTTP transport layer. */
export interface HttpTransportOptions {
    /**
     * Specifies whether to use the testnet API endpoints.
     * @defaultValue `false`
     */
    isTestnet?: boolean;

    /**
     * Request timeout in ms.
     * Set to `null` to disable.
     * @defaultValue `10_000`
     */
    timeout?: number | null;

    /**
     * Server to use for API requests.
     * Can be a predefined server name or a custom URLs object.
     * @defaultValue `api`
     */
    server?:
        | "api"
        | "api2"
        | "api-ui"
        | {
            mainnet?: {
                api?: string | URL;
                rpc?: string | URL;
            };
            testnet?: {
                api?: string | URL;
                rpc?: string | URL;
            };
        };

    /** A custom {@linkcode https://developer.mozilla.org/en-US/docs/Web/API/RequestInit | RequestInit} that is merged with a fetch request. */
    fetchOptions?: Omit<RequestInit, "body" | "method">;

    /**
     * A callback function that is called before the request is sent.
     * @param request - An original request to send.
     * @returns If returned a {@linkcode https://developer.mozilla.org/en-US/docs/Web/API/Request/Request | Request}, it will replace the original request.
     */
    onRequest?: (request: Request) => MaybePromise<Request | void | null | undefined>;

    /**
     * A callback function that is called after the response is received.
     * @param response - An original response to process.
     * @returns If returned a {@linkcode https://developer.mozilla.org/en-US/docs/Web/API/Response/Response | Response}, it will replace the original response.
     */
    onResponse?: (response: Response) => MaybePromise<Response | void | null | undefined>;
}

/** HTTP implementation of the REST transport interface. */
export class HttpTransport implements IRequestTransport, HttpTransportOptions {
    /** Predefined server configurations for the Hyperliquid API. */
    protected static readonly servers = {
        api: {
            mainnet: {
                api: "https://api.hyperliquid.xyz",
                rpc: "https://rpc.hyperliquid.xyz",
            },
            testnet: {
                api: "https://api.hyperliquid-testnet.xyz",
                rpc: "https://rpc.hyperliquid-testnet.xyz",
            },
        },
        api2: {
            mainnet: {
                api: "https://api2.hyperliquid.xyz",
                rpc: "https://rpc.hyperliquid.xyz",
            },
            testnet: {
                api: "https://api2.hyperliquid-testnet.xyz",
                rpc: "https://rpc.hyperliquid-testnet.xyz",
            },
        },
        "api-ui": {
            mainnet: {
                api: "https://api-ui.hyperliquid.xyz",
                rpc: "https://rpc.hyperliquid.xyz",
            },
            testnet: {
                api: "https://api-ui.hyperliquid-testnet.xyz",
                rpc: "https://rpc.hyperliquid-testnet.xyz",
            },
        },
    };

    isTestnet: boolean;
    timeout: number | null;
    server: "api" | "api2" | "api-ui" | {
        mainnet?: {
            api?: string | URL;
            rpc?: string | URL;
        };
        testnet?: {
            api?: string | URL;
            rpc?: string | URL;
        };
    };
    fetchOptions: Omit<RequestInit, "body" | "method">;
    onRequest?: (request: Request) => MaybePromise<Request | void | null | undefined>;
    onResponse?: (response: Response) => MaybePromise<Response | void | null | undefined>;

    /**
     * Creates a new HTTP transport instance.
     * @param options - Configuration options for the HTTP transport layer.
     */
    constructor(options?: HttpTransportOptions) {
        this.isTestnet = options?.isTestnet ?? false;
        this.timeout = options?.timeout === undefined ? 10_000 : options.timeout;
        this.server = options?.server ?? "api";
        this.fetchOptions = options?.fetchOptions ?? {};
        this.onRequest = options?.onRequest;
        this.onResponse = options?.onResponse;
    }

    /**
     * Returns the API and RPC endpoint URLs for the specified server.
     * @returns An object containing the API and RPC endpoint URLs for the mainnet and testnet.
     */
    protected get endpointPaths(): {
        mainnet: { api: string | URL; rpc: string | URL };
        testnet: { api: string | URL; rpc: string | URL };
    } {
        if (typeof this.server === "string") {
            return HttpTransport.servers[this.server];
        }
        return {
            mainnet: {
                api: this.server.mainnet?.api ?? HttpTransport.servers.api.mainnet.api,
                rpc: this.server.mainnet?.rpc ?? HttpTransport.servers.api.mainnet.rpc,
            },
            testnet: {
                api: this.server.testnet?.api ?? HttpTransport.servers.api.testnet.api,
                rpc: this.server.testnet?.rpc ?? HttpTransport.servers.api.testnet.rpc,
            },
        };
    }

    /**
     * Sends a request to the Hyperliquid API via fetch.
     * @param endpoint - The API endpoint to send the request to.
     * @param payload - The payload to send with the request.
     * @param signal - An optional abort signal.
     * @returns A promise that resolves with parsed JSON response body.
     * @throws {HttpRequestError} - Thrown when an HTTP response is deemed invalid.
     * @throws May throw {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch#exceptions | fetch errors}.
     */
    async request(
        endpoint: "info" | "exchange" | "explorer",
        payload: unknown,
        signal?: AbortSignal,
    ): Promise<unknown> {
        // Construct a Request
        const url = new URL(
            endpoint,
            this.endpointPaths[this.isTestnet ? "testnet" : "mainnet"][endpoint === "explorer" ? "rpc" : "api"],
        );
        const init = mergeRequestInit(
            {
                body: JSON.stringify(payload),
                headers: {
                    "Accept-Encoding": "gzip, deflate, br, zstd",
                    "Connection": "keep-alive",
                    "Content-Type": "application/json",
                },
                keepalive: true,
                method: "POST",
                signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined,
            },
            this.fetchOptions,
            { signal },
        );
        let request = new Request(url, init);

        // Call the onRequest callback, if provided
        if (this.onRequest) {
            const customRequest = await this.onRequest(request);
            if (customRequest instanceof Request) request = customRequest;
        }

        // Send the Request and wait for a Response
        let response = await fetch(request);

        // Call the onResponse callback, if provided
        if (this.onResponse) {
            const customResponse = await this.onResponse(response);
            if (customResponse instanceof Response) response = customResponse;
        }

        // Validate the Response
        if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
            // Unload the response body to prevent memory leaks
            const body = await response.text().catch(() => undefined);
            throw new HttpRequestError(response, body);
        }

        // Parse the response body
        const body = await response.json();

        // Check if the response is an error
        if (body?.type === "error") {
            throw new HttpRequestError(response, body?.message);
        }

        // Return the response body
        return body;
    }
}

/**
 * Merges multiple `HeadersInit` objects into one.
 * @param inits - A list of `HeadersInit` objects to merge.
 * @returns A new `Headers` object that contains all headers from the input objects.
 */
function mergeHeadersInit(...inits: HeadersInit[]): Headers {
    if (inits.length === 0 || inits.length === 1) {
        return new Headers(inits[0] as HeadersInit | undefined);
    }

    const merged = new Headers();
    for (const headers of inits) {
        const entries = Symbol.iterator in headers ? headers : Object.entries(headers);
        for (const [key, value] of entries) {
            merged.set(key, value);
        }
    }
    return merged;
}

/**
 * Merges multiple `RequestInit` objects into one.
 * @param inits - A list of `RequestInit` objects to merge.
 * @returns A new `RequestInit` object that contains all properties from the input objects.
 */
function mergeRequestInit(...inits: RequestInit[]): RequestInit {
    const merged = inits.reduce((acc, init) => ({ ...acc, ...init }), {});

    const headersList = inits.map((init) => init.headers)
        .filter((headers) => typeof headers === "object");
    if (headersList.length > 0) {
        merged.headers = mergeHeadersInit(...headersList);
    }

    const signals = inits.map((init) => init.signal)
        .filter((signal) => signal instanceof AbortSignal);
    if (signals.length > 0) {
        merged.signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    }

    return merged;
}
