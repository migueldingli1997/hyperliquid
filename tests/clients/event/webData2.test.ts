import { deadline } from "jsr:@std/async@^1.0.10/deadline";
import { privateKeyToAccount } from "npm:viem@^2.21.7/accounts";
import BigNumber from "npm:bignumber.js@^9.1.2";
import { EventClient, PublicClient, WalletClient, WebSocketTransport } from "../../../mod.ts";
import { schemaGenerator } from "../../_utils/schema/schemaGenerator.ts";
import { schemaCoverage } from "../../_utils/schema/schemaCoverage.ts";
import { formatPrice, formatSize, getAssetData, randomCloid } from "../../_utils/utils.ts";

const PRIVATE_KEY = Deno.args[0] as `0x${string}`;
const PERPS_ASSET_1 = "BTC";
const PERPS_ASSET_2 = "ETH";

// —————————— Type schema ——————————

export type MethodReturnType = Parameters<Parameters<EventClient["webData2"]>[1]>[0];
const MethodReturnType = schemaGenerator(import.meta.url, "MethodReturnType");

// —————————— Test ——————————

Deno.test("webData2", async () => {
    if (!Deno.args.includes("--not-wait")) await new Promise((resolve) => setTimeout(resolve, 1000));

    // —————————— Prepare ——————————

    // Create clients
    const transport = new WebSocketTransport({ url: "wss://api.hyperliquid-testnet.xyz/ws", timeout: 20_000 });
    const publicClient = new PublicClient({ transport });
    const eventClient = new EventClient({ transport });
    const walletClient = new WalletClient({
        wallet: privateKeyToAccount(PRIVATE_KEY),
        transport,
        isTestnet: true,
    });

    // Get asset data
    const { id: id1, pxUp: pxUp1, pxDown: pxDown1, sz: sz1, twapSz: twapSz1 } = await getAssetDataExtended(
        publicClient,
        PERPS_ASSET_1,
    );
    const { id: id2, pxUp: pxUp2, pxDown: pxDown2, sz: sz2, twapSz: twapSz2 } = await getAssetDataExtended(
        publicClient,
        PERPS_ASSET_2,
    );

    await Promise.all([
        walletClient.updateLeverage({ asset: id1, isCross: true, leverage: 5 }),
        walletClient.updateLeverage({ asset: id2, isCross: false, leverage: 5 }),
    ]);
    const [twap1, twap2] = await Promise.all([
        // Create TWAP orders
        walletClient.twapOrder({ a: id1, b: true, s: twapSz1, r: false, m: 5, t: false }),
        walletClient.twapOrder({ a: id2, b: false, s: twapSz2, r: false, m: 5, t: false }),
        // Create orders
        walletClient.order({
            orders: [{ a: id1, b: true, p: pxDown1, s: sz1, r: false, t: { limit: { tif: "Gtc" } } }],
            grouping: "na",
        }),
        walletClient.order({
            orders: [{ a: id1, b: false, p: pxUp1, s: sz1, r: false, t: { limit: { tif: "Gtc" } } }],
            grouping: "na",
        }),
        walletClient.order({
            orders: [{ a: id1, b: false, p: pxUp1, s: sz1, r: false, t: { limit: { tif: "Alo" } }, c: randomCloid() }],
            grouping: "na",
        }),
        walletClient.order({ // orderType = "Stop Market"
            orders: [{
                a: id1,
                b: false,
                p: pxDown1,
                s: sz1,
                r: false,
                t: { trigger: { isMarket: true, tpsl: "sl", triggerPx: pxDown1 } },
            }],
            grouping: "na",
        }),
        walletClient.order({ // orderType = "Stop Limit"
            orders: [{
                a: id1,
                b: false,
                p: pxDown1,
                s: sz1,
                r: false,
                t: { trigger: { isMarket: false, tpsl: "sl", triggerPx: pxDown1 } },
            }],
            grouping: "na",
        }),
        // Create positions
        walletClient.order({
            orders: [{ a: id1, b: true, p: pxUp1, s: sz1, r: false, t: { limit: { tif: "Gtc" } } }],
            grouping: "na",
        }),
        walletClient.order({
            orders: [{ a: id2, b: false, p: pxDown2, s: sz2, r: false, t: { limit: { tif: "Gtc" } } }],
            grouping: "na",
        }),
        // Change spot dusting opt-out
        walletClient.spotUser({ toggleSpotDusting: { optOut: true } }),
    ]);

    // —————————— Test ——————————

    try {
        const data = await deadline(
            new Promise((resolve) => {
                eventClient.webData2({ user: walletClient.wallet.address }, resolve);
            }),
            40_000,
        );

        schemaCoverage(MethodReturnType, [data], {
            ignoreBranchesByPath: {
                "#/properties/openOrders/items/properties/tif/anyOf": [
                    1, // tif = null
                ],
                "#/properties/agentAddress/anyOf": [
                    1, // agentAddress = null
                ],
            },
            ignoreEmptyArrayPaths: [
                "#/properties/openOrders/items/properties/children",
            ],
            ignoreEnumValuesByPath: {
                "#/properties/openOrders/items/properties/orderType": [
                    "Market",
                    "Take Profit Limit",
                    "Take Profit Market",
                ],
                "#/properties/openOrders/items/properties/tif/anyOf/0": ["FrontendMarket", "Ioc", "LiquidationMarket"],
            },
            ignoreTypesByPath: {
                "#/properties/agentValidUntil": ["null"], // related to agentAddress
            },
            ignorePropertiesByPath: [
                "#/properties/perpsAtOpenInterestCap",
            ],
        });
    } finally {
        // —————————— Cleanup ——————————

        // Close open orders & TWAP's
        const openOrders = await publicClient.openOrders({ user: walletClient.wallet.address });
        const cancels = openOrders.map((o) => ({ a: o.coin === PERPS_ASSET_1 ? id1 : id2, o: o.oid }));
        await Promise.all([
            walletClient.cancel({ cancels }),
            walletClient.twapCancel({ a: id1, t: twap1.response.data.status.running.twapId }),
            walletClient.twapCancel({ a: id2, t: twap2.response.data.status.running.twapId }),
        ]);

        // Close open positions
        await Promise.all([
            walletClient.order({
                orders: [{
                    a: id1,
                    b: false,
                    p: pxDown1,
                    s: "0", // Full position size
                    r: true,
                    t: { limit: { tif: "Gtc" } },
                }],
                grouping: "na",
            }),
            walletClient.order({
                orders: [{
                    a: id2,
                    b: true,
                    p: pxUp2,
                    s: "0", // Full position size
                    r: true,
                    t: { limit: { tif: "Gtc" } },
                }],
                grouping: "na",
            }),
        ]);

        // Change spot dusting opt-out
        await walletClient.spotUser({ toggleSpotDusting: { optOut: false } });

        // Close the transport
        await transport.close();
    }
});

async function getAssetDataExtended(publicClient: PublicClient, asset: string): Promise<{
    id: number;
    pxUp: string;
    pxDown: string;
    sz: string;
    twapSz: string;
}> {
    const { id, universe, ctx } = await getAssetData(publicClient, asset);
    const pxUp = formatPrice(new BigNumber(ctx.markPx).times(1.01), universe.szDecimals);
    const pxDown = formatPrice(new BigNumber(ctx.markPx).times(0.99), universe.szDecimals);
    const sz = formatSize(new BigNumber(15).div(ctx.markPx), universe.szDecimals);
    const twapSz = formatSize(new BigNumber(55).div(ctx.markPx), universe.szDecimals);
    return { id, pxUp, pxDown, sz, twapSz };
}
