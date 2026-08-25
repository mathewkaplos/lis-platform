import { FormField, Input } from '@lis/ui';

/**
 * Issue #747 (docs/plans/task-747-patient-demographic-editing.md): extracted
 * out of `patients/new/page.tsx` so the edit screen reuses the exact same
 * fields/validation-error wiring rather than a second, parallel form (the
 * proposal's own explicit shape). Registration-specific concerns (duplicate
 * review banner, success screen) stay in `new/page.tsx` — this component is
 * just the field set both screens share.
 */
export interface PatientFormValues {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  sex?: string;
  birthDate?: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  address?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
}

export function PatientFormFields({
  values,
  fieldErrors,
}: {
  values?: PatientFormValues;
  fieldErrors?: Record<string, string[] | undefined>;
}) {
  return (
    <>
      <FormField
        id="firstName"
        label="First name"
        required
        errorText={fieldErrors?.firstName?.[0]}
      >
        <Input name="firstName" defaultValue={values?.firstName} required />
      </FormField>
      <FormField
        id="middleName"
        label="Middle name"
        errorText={fieldErrors?.middleName?.[0]}
      >
        <Input name="middleName" defaultValue={values?.middleName} />
      </FormField>
      <FormField
        id="lastName"
        label="Last name"
        required
        errorText={fieldErrors?.lastName?.[0]}
      >
        <Input name="lastName" defaultValue={values?.lastName} required />
      </FormField>
      <FormField id="sex" label="Sex" required errorText={fieldErrors?.sex?.[0]}>
        <select
          name="sex"
          required
          defaultValue={values?.sex ?? ''}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="" disabled>
            Select…
          </option>
          <option value="F">Female</option>
          <option value="M">Male</option>
          <option value="U">Unknown</option>
        </select>
      </FormField>
      <FormField
        id="birthDate"
        label="Date of birth"
        errorText={fieldErrors?.birthDate?.[0]}
      >
        <Input type="date" name="birthDate" defaultValue={values?.birthDate} />
      </FormField>
      <FormField
        id="nationalId"
        label="National ID"
        errorText={fieldErrors?.nationalId?.[0]}
      >
        <Input name="nationalId" defaultValue={values?.nationalId} />
      </FormField>
      <FormField id="phone" label="Phone" errorText={fieldErrors?.phone?.[0]}>
        <Input name="phone" defaultValue={values?.phone} />
      </FormField>
      <FormField id="email" label="Email" errorText={fieldErrors?.email?.[0]}>
        <Input type="email" name="email" defaultValue={values?.email} />
      </FormField>
      <FormField id="address" label="Address" errorText={fieldErrors?.address?.[0]}>
        <Input name="address" defaultValue={values?.address} />
      </FormField>
      <FormField
        id="nextOfKinName"
        label="Next of kin name"
        errorText={fieldErrors?.nextOfKinName?.[0]}
      >
        <Input name="nextOfKinName" defaultValue={values?.nextOfKinName} />
      </FormField>
      <FormField
        id="nextOfKinPhone"
        label="Next of kin phone"
        errorText={fieldErrors?.nextOfKinPhone?.[0]}
      >
        <Input name="nextOfKinPhone" defaultValue={values?.nextOfKinPhone} />
      </FormField>
    </>
  );
}
