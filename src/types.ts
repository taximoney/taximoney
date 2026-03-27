export type PaymentMethod = 'Tarjeta' | 'Efectivo';

export interface Trip {
  id: string;
  amount: number;
  tip: number;
  method: PaymentMethod;
  time: string;
  timestamp: number;
}

export interface Shift {
  id: string;
  date: string;
  month: string;
  trips: Trip[];
  hours: number;
  totals: {
    caja: number;
    propinas: number;
    propinaTarjeta: number;
    tarjeta: number;
    efectivo: number;
    mio: number;
    jefe: number;
    ajuste: number;
  };
  config: {
    driverPercent: number;
  };
}

export interface AppConfig {
  driverPercent: number;
}
