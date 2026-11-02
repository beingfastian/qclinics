// Specialities offered in the staff app's doctor forms and filters. A doctor whose
// speciality isn't listed (e.g. added by an import) keeps it: the forms add the
// doctor's own value to the choices (withCurrent).
export const SPECIALITIES = [
  "General physician",
  "Physician",
  "Gynecologist",
  "Child Specialist",
  "Pediatricians",
  "Children Surgeon",
  "Cardiologist",
  "ENT Specialist",
  "Dermatologist",
  "Neurologist",
  "Gastroenterologist",
  "General Surgeon",
  "Orthopedic Surgeon",
  "Plastic Surgeon",
  "Urologist",
  "Rheumatologist",
  "Ultrasound (USG) Specialist",
  "Physiotherapist",
  "Dentist",
  "Eye Specialist",
  "Psychiatrist",
  "Pulmonologist",
  "Nephrologist",
];

export const withCurrent = (list, current) => (current && !list.includes(current) ? [current, ...list] : list);
