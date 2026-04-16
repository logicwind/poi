/**
 * build.ts — creates the `poi-base` template container.
 *
 * Debian 12 + Node LTS + Pi + git/ripgrep/jq. Stopped when done. `poi shell`
 * clones ephemeral copies from it per session.
 *
 * Pi's state (auth, sessions, models, settings) lives on the host under
 * ~/.pi/agent and is bind-mounted per session — we do NOT install any keys
 * or config inside the template.
 *
 * Re-running is idempotent: if the template already exists, it's stopped
 * (if running) and left as-is.
 */

import { IncusClient } from "./incus/client.ts";
import {
  createAndStart,
  execInstance,
  getInstanceState,
  stopInstance,
  waitOperation,
} from "./incus/instances.ts";

const TEMPLATE = process.env.POI_TEMPLATE ?? "poi-base";
const IMAGE_ALIAS = process.env.POI_IMAGE ?? "debian/12";
const IMAGE_SERVER = "https://images.linuxcontainers.org";
const NODE_VERSION = process.env.POI_NODE_VERSION ?? "20";

export async function build(): Promise<void> {
  const client = new IncusClient();

  const existing = await getInstanceState(client, TEMPLATE).catch(() => null);
  if (existing) {
    if (existing.status === "Stopped") {
      console.log(`✓ template "${TEMPLATE}" already exists and is Stopped. ready.`);
      return;
    }
    console.log(`template "${TEMPLATE}" exists but is ${existing.status}. stopping…`);
    const op = await stopInstance(client, TEMPLATE, true);
    await waitOperation(client, op.id);
    console.log("✓ stopped. ready.");
    return;
  }

  console.log(`creating template "${TEMPLATE}" from ${IMAGE_ALIAS}…`);
  await createAndStart(client, {
    name: TEMPLATE,
    type: "container",
    source: {
      type: "image",
      alias: IMAGE_ALIAS,
      server: IMAGE_SERVER,
      protocol: "simplestreams",
    },
  });

  console.log("installing base packages…");
  const basePackages = [
    "apt-get update -qq",
    "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends",
    "  ca-certificates curl git build-essential",
    "  ripgrep jq less",
  ].join(" && ");
  await execInstance(client, TEMPLATE, ["bash", "-lc", basePackages]);

  console.log(`installing Node.js ${NODE_VERSION} via NodeSource…`);
  const installNode = [
    `curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -`,
    "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends nodejs",
  ].join(" && ");
  await execInstance(client, TEMPLATE, ["bash", "-lc", installNode]);

  console.log("installing Pi (@mariozechner/pi-coding-agent)…");
  await execInstance(client, TEMPLATE, [
    "bash",
    "-lc",
    "npm install -g --silent @mariozechner/pi-coding-agent",
  ]);

  console.log("cleaning caches…");
  await execInstance(client, TEMPLATE, [
    "bash",
    "-lc",
    "apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm",
  ]);

  console.log("stopping template…");
  const stopOp = await stopInstance(client, TEMPLATE, false);
  await waitOperation(client, stopOp.id);

  console.log(`✓ template "${TEMPLATE}" ready.`);
}

if (import.meta.main) {
  await build();
}
