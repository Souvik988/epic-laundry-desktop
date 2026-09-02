# V4 target architecture

```text
Customer app / website / vendor app / platform admin / rider cloud
                         |
                  Marketplace control plane
                         |
             authenticated vendor sync gateway
                         |
       Epic Laundry Desktop device (edge node, loopback only)
                         |
             Fastify + SQLite/WAL + production workflow
```

Desktop is not a public API server. It remains usable in **Local Standalone** mode. **Marketplace Connected** mode is capability-gated and requires a registered device credential, a versioned cloud contract, and durable at-least-once synchronization.

The existing `Lndry_backend` is a reference implementation for current customer/rider/payment concepts, not an approved control plane contract or a direct desktop dependency.
