import "dotenv/config";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { OntologyStore } from "../src/ontology/state/store.js";
import { transformOrder, transformDriver, transformMarket } from "../src/ontology/sync/transformer.js";
import { createOntologyTools } from "../src/tools/ontology-tools.js";
import { createRedisClient } from "../src/memory/redis/client.js";

const s3 = new S3Client({ region: "us-east-1" });
const result = await s3.send(new GetObjectCommand({ Bucket: "valleyeats", Key: "dispatch.txt" }));
const data = JSON.parse(await result.Body!.transformToString());
const store = new OntologyStore();

const zones = Object.keys(data).filter((k) => k !== "Timestamp");
for (const z of zones) {
  for (const o of (data[z].Orders ?? [])) { try { store.updateOrders([...store.queryOrders({}), transformOrder({ ...o, DeliveryZone: o.DeliveryZone ?? z })]); } catch {} }
  for (const d of (data[z].Drivers ?? [])) { try { store.updateDrivers([...store.queryDrivers({}), transformDriver({ ...d, DispatchZone: d.DispatchZone ?? z, Active: d.Active ?? true })]); } catch {} }
  if (data[z].Meter) { try { const existing = Array.from((store as any).markets.values()); store.updateMarkets([...existing, transformMarket({ Market: z, ...data[z].Meter })]); } catch {} }
}

console.log(`Store: ${store.getStats().orders} orders, ${store.getStats().drivers} drivers, ${store.getStats().markets} markets`);

const redis = createRedisClient("redis://localhost:6379/0");
const tools = createOntologyTools(store, redis, "test");

// Test each tool and show EXACTLY what the LLM sees
console.log("\n========== query_orders({deliveryZone: 'Pembroke'}) ==========");
const r1 = await tools.find((t) => t.name === "query_orders")!.invoke({ deliveryZone: "Pembroke" });
console.log(r1);

console.log("\n========== query_drivers({dispatchZone: 'Pembroke'}) ==========");
const r2 = await tools.find((t) => t.name === "query_drivers")!.invoke({ dispatchZone: "Pembroke" });
console.log(r2);

console.log("\n========== get_order_details (first order by OrderIdKey) ==========");
const firstOrder = store.queryOrders({})[0];
if (firstOrder) {
  console.log("Looking up:", firstOrder.orderIdKey);
  const r3 = await tools.find((t) => t.name === "get_order_details")!.invoke({ orderId: firstOrder.orderIdKey });
  console.log(r3);
}

console.log("\n========== query_tickets({}) ==========");
const r4 = await tools.find((t) => t.name === "query_tickets")!.invoke({});
console.log(r4);

redis.disconnect();
process.exit(0);
