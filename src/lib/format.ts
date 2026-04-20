export const ksh = (n: number) =>
  "Ksh " + Math.round(n).toLocaleString("en-KE");

export const qty = (n: number, unit: string) => {
  if (unit === "kg") return `${(Math.round(n * 1000) / 1000).toFixed(3)} kg`;
  return `${Math.round(n)} ${unit}`;
};
