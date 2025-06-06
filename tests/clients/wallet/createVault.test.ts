import { assertRejects } from "jsr:@std/assert@^1.0.10";
import { privateKeyToAccount } from "npm:viem@^2.21.7/accounts";
import { ApiRequestError, HttpTransport, WalletClient } from "../../../mod.ts";

// —————————— Constants ——————————

const PRIVATE_KEY = Deno.args[0] as `0x${string}`;

// —————————— Test ——————————

// NOTE: There is a $100 fee for creating a vault.
// So to prove that the method works, we will expect a specific error when the balance is less than $100.
Deno.test("createVault", async () => {
    if (!Deno.args.includes("--not-wait")) await new Promise((resolve) => setTimeout(resolve, 1000));

    // —————————— Prepare ——————————

    const account = privateKeyToAccount(PRIVATE_KEY);
    const transport = new HttpTransport({ isTestnet: true });
    const walletClient = new WalletClient({ wallet: account, transport, isTestnet: true });

    // —————————— Test ——————————

    await assertRejects(
        () =>
            walletClient.createVault({
                name: `VaultName_${Date.now()}`,
                description: "This is an example of a vault description",
                initialUsd: 50 * 1e6, // $50
            }),
        ApiRequestError,
        "Initial deposit in vault is less than $100",
    );
});
