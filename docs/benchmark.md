# Synthetic benchmark guide

> Benchmark results were measured using synthetic files in this public demo environment. They do not represent any employer, customer, or production system.

No Lambda result is committed until the workload is actually deployed and measured. The local command below only checks the checksum hot path and emits JSON; it is not evidence of Lambda performance:

```bash
npm run benchmark -- --file-size-mb 1 --iterations 50
```

For a valid Lambda benchmark, deploy a dedicated development stack, upload synthetic files at multiple sizes, and invoke enough times to separate cold and warm samples. Repeat at each memory setting, record architecture and region, and export CloudWatch `Duration`, `Errors`, and `Invocations`. Calculate success rate, p50/p95 duration, cold-start count, and estimated cost per 1,000 using current regional prices.

|  Memory | File size | Invocations | Cold / warm | Average duration | Success rate | Estimated cost / 1,000 |
| ------: | --------: | ----------: | ----------: | ---------------: | -----------: | ---------------------: |
|  512 MB |     1 MiB |           — |           — |     Not measured | Not measured |           Not measured |
| 1024 MB |     1 MiB |           — |           — |     Not measured | Not measured |           Not measured |

Delete the development stack and uploaded objects after collecting results. AWS deployment and benchmarking incur real charges and are intentionally not run by this repository's CI.
