import { generateKeyPair } from "@futurity/plugins/signing";

const { privateKey, publicKey } = generateKeyPair();

console.log("\nPrivate key (PKCS8 DER, base64) — keep secret; put it in .env:\n");
console.log(`FUTURITY_SIGNING_KEY=${privateKey}\n`);
console.log("Public key (SPKI DER, base64) — use this to verify the manifest when registering in Futurity:\n");
console.log(`${publicKey}\n`);
