import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

export function getCurrentTime(): string {
  const now = new Date();
  return now.getHours().toString().padStart(2, '0') + ":" + 
         now.getMinutes().toString().padStart(2, '0');
}
