'use client';

import { useActionState } from 'react';
import { Button, Input, Label } from '@lis/ui';
import { acknowledgeCritical } from './actions';
import { acknowledgeCriticalInitialState } from './types';

/**
 * FEAT-038: a documented read-back is a real, required field (KB-33 "first-
 * class ack/read-back endpoint"), not a bare confirm button -- matches
 * `acknowledgeCriticalNotificationSchema`'s own required `readBack` string.
 */
export function CriticalAckForm({ notificationId }: { notificationId: string }) {
  const [state, formAction, pending] = useActionState(
    acknowledgeCritical,
    acknowledgeCriticalInitialState,
  );

  if (state.status === 'acknowledged') {
    return <p className="text-sm text-success">Acknowledged.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="notificationId" value={notificationId} />
      <div className="flex-1">
        <Label htmlFor={`readback-${notificationId}`} className="sr-only">
          Read-back
        </Label>
        <Input
          id={`readback-${notificationId}`}
          name="readBack"
          placeholder="Documented read-back (e.g. read back to Dr. X, confirmed value)"
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Acknowledging…' : 'Acknowledge'}
      </Button>
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger sm:basis-full">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
