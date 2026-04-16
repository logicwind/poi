/**
 * status.ts — prints template state and any running poi-* ephemeral containers.
 */

import { z } from "zod";
import { IncusClient } from "./incus/client.ts";
import { getInstanceState } from "./incus/instances.ts";
import { incusSyncSchema } from "./incus/schemas.ts";

const InstanceListSchema = incusSyncSchema(
  z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      type: z.string(),
      ephemeral: z.boolean().optional(),
    }),
  ),
);

const TEMPLATE = process.env.POI_TEMPLATE ?? "poi-base";

export async function status(): Promise<void> {
  const client = new IncusClient();

  const tmpl = await getInstanceState(client, TEMPLATE).catch(() => null);
  if (!tmpl) {
    console.log(`template:  ✗ "${TEMPLATE}" does not exist. run: poi build`);
  } else {
    console.log(`template:  ✓ "${TEMPLATE}" (${tmpl.status})`);
  }

  const response = await client.get("/1.0/instances?recursion=1", InstanceListSchema);
  const poiInstances = response.metadata.filter(
    (i) => i.name.startsWith("poi-") && i.name !== TEMPLATE,
  );

  if (poiInstances.length === 0) {
    console.log("active:    (none)");
    return;
  }
  console.log(`active:    ${poiInstances.length} ephemeral container(s)`);
  for (const inst of poiInstances) {
    const eph = inst.ephemeral ? " [ephemeral]" : "";
    console.log(`  - ${inst.name} (${inst.status})${eph}`);
  }
}

if (import.meta.main) {
  await status();
}
