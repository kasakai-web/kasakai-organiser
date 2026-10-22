// Validation utilities
export const validatePhone = (phone: string): boolean => {
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.length === 10 && /^[6-9]/.test(cleaned);
};

export const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const formatPhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
  }
  return phone;
};

// Indian names sample data
export const INDIAN_NAMES = [
  "Aarav", "Vihaan", "Aditya", "Aryan", "Rohan",
  "Vikram", "Rajesh", "Amit", "Priya", "Ananya",
];
