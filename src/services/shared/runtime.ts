/**
 * Runtime helpers to run Effect services in Promise-based application code
 * This is a bridge to allow current application code to work with Effect services
 * TODO: Update application to use Effect directly and remove this file
 */

import { Effect } from 'effect'
import { AppLayer } from './layers'

/**
 * Run an Effect with all application services provided
 */
export function runWithServices<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(AppLayer)))
}
