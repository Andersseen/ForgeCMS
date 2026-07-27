import { createError, defineEventHandler, readBody } from 'h3';
import { isForgeError, ValidationFailedError } from '@forge-cms/runtime';
import { getServerRuntime } from '../../../api/runtime';
import type { BookingRequest } from '../../../../shared/site-content';

/**
 * The public booking form.
 *
 * It cannot go through `POST /api/v1/bookings`: that route hardcodes `allowedRoles:
 * ['admin','editor']` before the collection's own access rule is consulted, so an anonymous visitor
 * is rejected at the transport layer no matter what `access.create` says (finding 5).
 *
 * Going through the Local API instead — with `overrideAccess: false` and `user: null` — is not a
 * bypass: the collection's `access.create` rule is what grants this, and the `beforeChange` hook
 * still forces `status: 'pending'` so a crafted body cannot self-confirm an appointment.
 */
export default defineEventHandler(async (event) => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  let body: Partial<BookingRequest>;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' });
  }

  try {
    const booking = await runtime.create({
      collection: 'bookings',
      overrideAccess: false,
      user: null,
      data: {
        name: body.name,
        email: body.email,
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.service !== undefined && body.service !== '' && { service: body.service }),
        preferredDate: body.preferredDate,
        ...(body.notes !== undefined && { notes: body.notes }),
        source: 'website'
      }
    });

    // Deliberately narrow: the visitor gets a confirmation id, never the stored document (which
    // carries staff-only fields).
    return { data: { id: String(booking.id), status: 'pending' } };
  } catch (err) {
    if (err instanceof ValidationFailedError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation failed',
        data: { error: 'Validation failed', details: err.details }
      });
    }
    if (isForgeError(err)) {
      throw createError({ statusCode: err.status, statusMessage: err.message });
    }
    throw err;
  }
});
