export const PASSWORD_MIN_LENGTH = 10;

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La contrasena debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (!/[A-Z]/.test(password)) {
    return "La contrasena debe contener al menos una letra mayuscula.";
  }
  if (!/[a-z]/.test(password)) {
    return "La contrasena debe contener al menos una letra minuscula.";
  }
  if (!/[0-9]/.test(password)) {
    return "La contrasena debe contener al menos un numero.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "La contrasena debe contener al menos un simbolo.";
  }

  return null;
}
