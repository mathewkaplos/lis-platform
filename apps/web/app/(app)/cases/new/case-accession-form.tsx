'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@lis/ui';
import { createCase } from './actions';
import { createCaseInitialState } from './types';

const REJECTION_REASONS = [
  { value: '', label: 'None' },
  { value: 'haemolysed', label: 'Haemolysed' },
  { value: 'clotted', label: 'Clotted' },
  { value: 'insufficient_volume', label: 'Insufficient volume' },
  { value: 'mislabelled', label: 'Mislabelled' },
  { value: 'wrong_container', label: 'Wrong container' },
  { value: 'improper_temperature', label: 'Improper temperature' },
  { value: 'expired', label: 'Expired' },
] as const;

interface PartRow {
  id: string;
  specimenType: string;
  rejectionReason: string;
}

function newRow(): PartRow {
  return { id: crypto.randomUUID(), specimenType: '', rejectionReason: '' };
}

/**
 * Issue #633. Dynamic specimen-part list -- client-side array state only,
 * no server round trip per row (matches `order-builder-form.tsx`'s own
 * "client-side, not a server round trip" reasoning for its own selection
 * state). Serialized to a hidden JSON field on submit, same convention that
 * page's own `testDefinitionIds`/`panelIds` hidden fields already
 * establish for a dynamic-length list that doesn't compose with native
 * form serialization otherwise.
 *
 * `specimenType` is a plain text input, not a dropdown -- the backend
 * genuinely imposes no constraint on it (proposal §5), so a curated list
 * here would be inventing a business rule that doesn't exist anywhere else
 * in this codebase.
 */
export function CaseAccessionForm({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState(createCase, createCaseInitialState);
  const [rows, setRows] = useState<PartRow[]>([newRow()]);
  const [clientError, setClientError] = useState<string | undefined>(undefined);

  if (state.status === 'created') {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Case accessioned</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Accession number <span className="font-mono text-foreground">{state.createdAccessionNumber}</span>
          </p>
          <Button asChild className="w-fit">
            <Link href={`/cases/${state.createdCaseId}`}>View case</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  function updateRow(id: string, patch: Partial<PartRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  function handleSubmit(formData: FormData) {
    if (rows.length === 0) {
      setClientError('Add at least one specimen part.');
      return;
    }
    if (rows.some((row) => row.specimenType.trim() === '')) {
      setClientError('Enter a specimen type for every part.');
      return;
    }
    setClientError(undefined);
    formData.set('orderId', orderId);
    formData.set(
      'parts',
      JSON.stringify(
        rows.map((row) => ({
          specimenType: row.specimenType.trim(),
          rejectionReason: row.rejectionReason || undefined,
        })),
      ),
    );
    formAction(formData);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      {(clientError ?? (state.status === 'error' ? state.formError : undefined)) ? (
        <p role="alert" className="text-sm text-danger">
          {clientError ?? state.formError}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Specimen parts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.map((row, index) => (
            <div key={row.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex items-end gap-2">
                <FormField
                  id={`specimen-type-${row.id}`}
                  label={`Part ${index + 1} specimen type`}
                  className="flex-1"
                >
                  <Input
                    value={row.specimenType}
                    onChange={(e) => updateRow(row.id, { specimenType: e.target.value })}
                    placeholder="e.g. tissue, cervical_cytology"
                    required
                  />
                </FormField>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeRow(row.id)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <FormField id={`rejection-reason-${row.id}`} label="Rejection reason (optional)">
                <select
                  value={row.rejectionReason}
                  onChange={(e) => updateRow(row.id, { rejectionReason: e.target.value })}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {REJECTION_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setRows((prev) => [...prev, newRow()])}
          >
            Add another part
          </Button>
        </CardContent>
      </Card>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Accessioning…' : 'Accession case'}
      </Button>
    </form>
  );
}
