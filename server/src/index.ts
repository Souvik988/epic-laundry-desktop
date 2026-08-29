import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApi } from './api.js';
import { registerSeedAutomations } from './automations/seed.js';
import { listRows } from './kernel/entity-service.js';
import { assignLaundryOrder, bookLaundryOrder, createLaundryRider, laundryCatalogue, seedLaundryDefaults, transitionLaundryOrder } from './modules/laundry/domain.js';
import { laundryBusinessDate } from './modules/laundry/dates.js';

const TENANT = process.env.EPIC_TENANT || 'T1';
const PORT = Number(process.env.PORT || 3001);
const WORKSPACE_MODE = process.env.EPIC_WORKSPACE_MODE === 'demo' ? 'demo' : 'production';

const app = Fastify({ logger: true });
const configuredCorsOrigins = String(process.env.EPIC_CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
await app.register(cors, { origin: configuredCorsOrigins.length ? configuredCorsOrigins : false });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/ui/',
});

registerApi(app);
registerSeedAutomations(TENANT);
if (WORKSPACE_MODE === 'demo') {
  seedLaundryDefaults(TENANT);
  seedLaundryDemo();
}

function seedLaundryDemo() {
  if (listRows(TENANT, 'laundry_order').length) return;
  const catalogue = laundryCatalogue(TENANT);
  const garments = new Map(catalogue.garments.map((garment) => [garment.name, garment]));
  const services = new Map(catalogue.services.map((service) => [service.name, service]));
  const rider = createLaundryRider(TENANT, 'demo-seed', { name: 'Amit Das', phone: '9000000109' });
  const today = laundryBusinessDate();
  const day = (offset: number) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const samples = [
    ['Demo Priya', '9000000101', 'Shirt / T-shirt', 'Steam Iron', 'Home Delivery', 'Cash', 'Booked'],
    ['Demo Rahul', '9000000102', 'Trouser / Pant', 'Dry Cleaning', 'Pickup Order', 'Pay Later', 'Booked'],
    ['Demo Ananya', '9000000103', 'Saree', 'Dry Cleaning', 'Pickup Order', 'UPI', 'Picked Up'],
    ['Demo Kabir', '9000000104', 'Kurti', 'Steam Iron', 'Home Delivery', 'Card', 'In Process'],
    ['Demo Meera', '9000000105', 'Blanket', 'Dry Cleaning', 'Home Delivery', 'Pay Later', 'In Process'],
    ['Demo Suman', '9000000106', 'Bed sheet', 'Dry Cleaning', 'Home Delivery', 'Cash', 'Ready'],
    ['Demo Arjun', '9000000107', 'Mixed clothes', 'Wash & Fold', 'Home Delivery', 'UPI', 'Out for Delivery'],
    ['Demo Nisha', '9000000108', 'Shoe pair', 'Dry Cleaning', 'Home Delivery', 'Card', 'Delivered'],
  ] as const;
  for (const [index, [name, phone, garmentName, serviceName, fulfillmentMode, paymentMode, targetState]] of samples.entries()) {
    const garment = garments.get(garmentName);
    const service = services.get(serviceName);
    if (!garment || !service) continue;
    const result = bookLaundryOrder(TENANT, 'demo-seed', {
      orderDate: day(index - 7),
      customer: { name, phone },
      items: [{ garment: garment.id, service: service.id, qty: index % 3 + 1 }],
      expectedDeliveryDate: day(index + 1),
      fulfillmentMode,
      paymentMode,
    });
    if (targetState === 'Picked Up') {
      assignLaundryOrder(TENANT, 'demo-seed', result.order.id, { stage: 'pickup', riderId: rider.id });
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo intake complete');
    } else if (targetState === 'In Process') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
    } else if (targetState === 'Ready') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
    } else if (targetState === 'Out for Delivery') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
      assignLaundryOrder(TENANT, 'demo-seed', result.order.id, { stage: 'delivery', riderId: rider.id });
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Out for Delivery', 'Demo rider dispatched');
    } else if (targetState === 'Delivered') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Delivered', 'Demo customer handoff complete');
    }
  }
  console.log('[seed] laundry demo orders, customers and rider created');
}

try {
  await app.listen({ port: PORT, host: process.env.HOST || '127.0.0.1' });
  const address = app.server.address();
  const activePort = typeof address === 'object' && address ? address.port : PORT;
  const startupSecret = process.env.EPIC_STARTUP_SECRET;
  const startupNonce = process.env.EPIC_STARTUP_NONCE;
  if (startupSecret && startupNonce) {
    const proof = createHmac('sha256', startupSecret).update(`${startupNonce}:${activePort}`).digest('hex');
    console.log(`EPIC_READY ${JSON.stringify({ port: activePort, nonce: startupNonce, proof })}`);
  }
  console.log(`\n  Epic Laundry ${WORKSPACE_MODE} workspace on http://localhost:${activePort}`);
  console.log(`  Demo UI:         http://localhost:${activePort}/ui/`);
  console.log(`  API health:      http://localhost:${activePort}/api/health`);
  console.log('  Session auth:    enabled\n');
} catch (e) {
  console.error(e);
  process.exit(1);
}
