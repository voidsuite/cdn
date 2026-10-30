/**
 * Run the retention sweeper once (cron / manual maintenance).
 */

import { sweepOnce } from "../jobs/sweeper.js"

const result = await sweepOnce()
console.log(
  `[sweep] expired=${result.expired} intents=${result.intents} stale=${result.stale} errors=${result.errors}`
)
