import { assertEquals } from "jsr:@std/assert@^1.0.10";
import { privateKeyToAccount } from "npm:viem@^2.21.54/accounts";
import { createWalletClient, http } from "npm:viem@^2.21.54";
import { mainnet } from "npm:viem@^2.21.54/chains";
import { ethers } from "npm:ethers@^6.13.4";
import { HttpTransport, WalletClient } from "../../../mod.ts";

const PRIVATE_KEY = "0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff";

Deno.test("_guessSignatureChainId", async (t) => {
    await t.step("viem", async () => {
        const wallet = createWalletClient({
            account: privateKeyToAccount(PRIVATE_KEY),
            transport: http("https://ethereum-rpc.publicnode.com"),
            chain: mainnet,
        });
        const transport = new HttpTransport();
        const walletClient = new WalletClient({ wallet, transport });

        const signatureChainId = typeof walletClient.signatureChainId === "string"
            ? walletClient.signatureChainId
            : await walletClient.signatureChainId();
        assertEquals(signatureChainId, "0x1");
    });

    await t.step("ethers.js", async () => {
        const provider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

        const transport = new HttpTransport();
        const walletClient = new WalletClient({ wallet, transport });

        const signatureChainId = typeof walletClient.signatureChainId === "string"
            ? walletClient.signatureChainId
            : await walletClient.signatureChainId();
        assertEquals(signatureChainId, "0x1");
    });

    await t.step("window.ethereum", async () => {
        const ethereum = { // Mock window.ethereum
            // deno-lint-ignore require-await
            request: async ({ method }: { method: string }) => {
                if (method === "eth_chainId") {
                    return ["0x1"];
                }
            },
        };

        const transport = new HttpTransport();
        const walletClient = new WalletClient({ wallet: ethereum, transport });

        const signatureChainId = typeof walletClient.signatureChainId === "string"
            ? walletClient.signatureChainId
            : await walletClient.signatureChainId();
        assertEquals(signatureChainId, "0x1");
    });

    await t.step("default", async (t) => {
        const account = privateKeyToAccount(PRIVATE_KEY);

        await t.step("mainnet", async () => {
            const transport = new HttpTransport();
            const walletClient = new WalletClient({ wallet: account, transport });

            const signatureChainId = typeof walletClient.signatureChainId === "string"
                ? walletClient.signatureChainId
                : await walletClient.signatureChainId();
            assertEquals(signatureChainId, "0xa4b1");
        });

        await t.step("testnet", async () => {
            const transport = new HttpTransport();
            const walletClient = new WalletClient({ wallet: account, transport, isTestnet: true });

            const signatureChainId = typeof walletClient.signatureChainId === "string"
                ? walletClient.signatureChainId
                : await walletClient.signatureChainId();
            assertEquals(signatureChainId, "0x66eee");
        });
    });
});
