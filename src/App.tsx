/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  History, 
  Settings, 
  Plus, 
  CreditCard, 
  Banknote, 
  Trash2, 
  Save, 
  Clock, 
  TrendingUp,
  ChevronRight,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  BarChart3,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { Trip as LocalTrip, Shift, PaymentMethod, AppConfig } from './types';
import { cn, formatCurrency, getCurrentTime } from './lib/utils';
import { 
  auth, 
  db, 
  signIn, 
  logOut, 
  saveTrip, 
  deleteTrip as deleteFirestoreTrip, 
  saveShift,
  deleteShift as deleteFirestoreShift,
  updateDebt,
  saveUserConfig, 
  getUserConfig,
  Trip as FirestoreTrip,
  OperationType,
  handleFirestoreError
} from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';

export default function App() {
  const [activeTab, setActiveTab] = useState<'turno' | 'resumen' | 'stats' | 'ajustes'>('turno');
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // State
  const [currentTrips, setCurrentTrips] = useState<LocalTrip[]>([]);
  const [history, setHistory] = useState<Shift[]>([]);
  const [debt, setDebt] = useState<number>(0);
  const [config, setConfig] = useState<AppConfig>({ driverPercent: 40 });

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync
  useEffect(() => {
    if (!user) {
      setCurrentTrips([]);
      setHistory([]);
      setDebt(0);
      return;
    }

    // Sync Config & Debt
    getUserConfig(user.uid).then(savedConfig => {
      if (savedConfig) {
        setConfig({ driverPercent: savedConfig.driverPercent });
        setDebt(savedConfig.accumulatedDebt || 0);
      }
    });

    // Sync Trips (Real-time)
    const qTrips = query(
      collection(db, 'trips'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribeTrips = onSnapshot(qTrips, (snapshot) => {
      const tripsData: LocalTrip[] = snapshot.docs.map(doc => {
        const data = doc.data() as FirestoreTrip;
        return {
          id: doc.id,
          amount: data.amount,
          tip: data.tip,
          method: data.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta',
          time: new Date(data.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
          timestamp: new Date(data.timestamp).getTime()
        };
      });
      setCurrentTrips(tripsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'trips');
    });

    // Sync History (Real-time)
    const qShifts = query(
      collection(db, 'shifts'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribeShifts = onSnapshot(qShifts, (snapshot) => {
      const shiftsData: Shift[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          date: data.date,
          month: data.month,
          hours: data.hours,
          totals: data.totals,
          trips: [], // We don't store trips inside shift doc to save space, or we could
          config: { driverPercent: data.totals.driverPercent || 40 }
        } as Shift;
      });
      setHistory(shiftsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'shifts');
    });

    return () => {
      unsubscribeTrips();
      unsubscribeShifts();
    };
  }, [user]);

  // Save Config to Firestore
  useEffect(() => {
    if (user) {
      saveUserConfig({
        userId: user.uid,
        driverPercent: config.driverPercent,
        lastUpdated: new Date().toISOString(),
        accumulatedDebt: debt
      });
    }
  }, [config, user, debt]);

  const [hoursInput, setHoursInput] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('');
  const [tipInput, setTipInput] = useState<string>('');

  // Modal State
  const [modal, setModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm?: () => void;
    type: 'alert' | 'confirm';
  }>({ show: false, title: '', message: '', type: 'alert' });

  const showAlert = (title: string, message: string) => {
    setModal({ show: true, title, message, type: 'alert' });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ show: true, title, message, onConfirm, type: 'confirm' });
  };

  // Calculations
  const currentTotals = useMemo(() => {
    let caja = 0;
    let propinas = 0;
    let propinaTarjeta = 0;
    let tarjeta = 0;
    let efectivo = 0;

    currentTrips.forEach(t => {
      caja += t.amount;
      propinas += t.tip;
      if (t.method === 'Tarjeta') {
        tarjeta += (t.amount + t.tip);
        propinaTarjeta += t.tip;
      } else {
        efectivo += t.amount;
      }
    });

    const propinaEfectivo = propinas - propinaTarjeta;
    const miParteCaja = caja * (config.driverPercent / 100);
    const mio = miParteCaja + propinas;
    const jefe = caja * ((100 - config.driverPercent) / 100);
    
    const efectivoEnMano = efectivo + propinaEfectivo;
    const ajuste = efectivoEnMano - mio; // Positivo: debo al jefe, Negativo: jefe me debe

    return { caja, propinas, propinaTarjeta, propinaEfectivo, tarjeta, efectivo, mio, jefe, ajuste, miParteCaja };
  }, [currentTrips, config]);

  const monthlyData = useMemo(() => {
    const months: Record<string, { month: string, caja: number, propinas: number }> = {};
    
    // Sort history by timestamp to ensure chronological order in chart
    const sortedHistory = [...history].sort((a, b) => {
      // We don't have a direct timestamp on Shift, but we can try to parse the date or just use the order
      // For now, let's just group them.
      return 0; 
    });

    history.forEach(shift => {
      const m = shift.month; // e.g. "MARZO DE 2026"
      if (!months[m]) {
        months[m] = { month: m.split(' DE ')[0], caja: 0, propinas: 0 };
      }
      months[m].caja += shift.totals.caja;
      months[m].propinas += shift.totals.propinas;
    });

    return Object.values(months).reverse(); // Reverse to show latest months first or last depending on preference
  }, [history]);

  const addTrip = async (method: PaymentMethod) => {
    if (!user) {
      showAlert("Inicia Sesión", "Debes iniciar sesión para guardar tus viajes en la nube.");
      return;
    }

    const amount = parseFloat(amountInput.replace(',', '.')) || 0;
    const tip = parseFloat(tipInput.replace(',', '.')) || 0;

    if (amount <= 0 && tip <= 0) return;

    const tripData: Omit<FirestoreTrip, 'id'> = {
      userId: user.uid,
      amount,
      tip,
      paymentMethod: method === 'Efectivo' ? 'cash' : 'card',
      timestamp: new Date().toISOString(),
      driverPercent: config.driverPercent
    };

    await saveTrip(tripData);
    setAmountInput('');
    setTipInput('');
  };

  const deleteTrip = async (id: string) => {
    showConfirm("Borrar Viaje", "¿Seguro que quieres borrar este registro?", async () => {
      await deleteFirestoreTrip(id);
      setModal({ ...modal, show: false });
    });
  };

  const closeShift = async () => {
    if (currentTrips.length === 0 || !user) return;
    
    const hours = parseFloat(hoursInput.replace(',', '.')) || 0;
    if (hours <= 0) {
      showAlert("Atención", "Por favor, introduce las horas trabajadas para calcular tu media.");
      return;
    }

    showConfirm("Cerrar Turno", "¿Terminar el turno y guardar en el historial?", async () => {
      const now = new Date();
      const shiftData = {
        userId: user.uid,
        date: now.toLocaleDateString('es-ES'),
        month: now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase(),
        hours,
        totals: {
          caja: currentTotals.caja,
          propinas: currentTotals.propinas,
          propinaTarjeta: currentTotals.propinaTarjeta,
          tarjeta: currentTotals.tarjeta,
          efectivo: currentTotals.efectivo,
          mio: currentTotals.mio,
          jefe: currentTotals.jefe,
          ajuste: -currentTotals.ajuste,
          driverPercent: config.driverPercent
        },
        timestamp: now.toISOString()
      };

      try {
        // Save shift
        await saveShift(shiftData);
        
        // Update debt
        const newDebt = debt - currentTotals.ajuste;
        setDebt(newDebt);
        await updateDebt(user.uid, newDebt);

        // Delete current trips (they are now part of the shift)
        // In a real app, we might want to mark them as 'closed' instead of deleting
        // But for this simple app, we'll delete them from the 'trips' collection
        for (const trip of currentTrips) {
          await deleteFirestoreTrip(trip.id);
        }

        setHoursInput('');
        setActiveTab('resumen');
        setModal({ ...modal, show: false });
      } catch (error) {
        showAlert("Error", "No se pudo cerrar el turno. Inténtalo de nuevo.");
      }
    });
  };

  const resetDebt = async () => {
    if (!user) return;
    showConfirm("Reiniciar Saldo", "¿Poner el saldo acumulado a cero?", async () => {
      setDebt(0);
      await updateDebt(user.uid, 0);
      setModal({ ...modal, show: false });
    });
  };

  const exportToCSV = () => {
    if (history.length === 0) {
      showAlert("Exportar Datos", "No hay historial para exportar.");
      return;
    }

    const headers = ["Fecha", "Mes", "Horas", "Caja Total", "Propinas", "Mi Parte", "Jefe", "Ajuste"];
    const rows = history.map(shift => [
      shift.date,
      shift.month,
      shift.hours.toString(),
      shift.totals.caja.toFixed(2),
      shift.totals.propinas.toFixed(2),
      shift.totals.mio.toFixed(2),
      shift.totals.jefe.toFixed(2),
      shift.totals.ajuste.toFixed(2)
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `TaxiMoney_Historial_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const deleteShift = async (id: string) => {
    if (!user) return;
    const shiftToDelete = history.find(s => s.id === id);
    if (!shiftToDelete) return;

    showConfirm("Borrar Turno", "¿Seguro que quieres borrar este turno? El saldo acumulado se ajustará automáticamente.", async () => {
      try {
        const newDebt = debt - shiftToDelete.totals.ajuste;
        setDebt(newDebt);
        await updateDebt(user.uid, newDebt);
        await deleteFirestoreShift(id);
        setModal({ ...modal, show: false });
      } catch (error) {
        showAlert("Error", "No se pudo borrar el turno.");
      }
    });
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-taxi-yellow rounded-2xl mx-auto animate-bounce flex items-center justify-center shadow-2xl shadow-taxi-yellow/20">
            <img src="/icono.png" alt="Logo" className="w-10 h-10" />
          </div>
          <p className="text-white/40 font-mono text-xs uppercase tracking-widest">Cargando TaxiMoney...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 bg-taxi-yellow rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-taxi-yellow/20">
              <img src="/icono.png" alt="Logo" className="w-12 h-12" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white">TaxiMoney</h1>
              <p className="text-white/40 text-sm">Tu recaudación, siempre a salvo en la nube.</p>
            </div>
          </div>

          <div className="glass-card p-8 rounded-[2rem] border-white/10 space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-white/60">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={20} className="text-green-500" />
                </div>
                <p className="text-sm">Sincronización en tiempo real</p>
              </div>
              <div className="flex items-center gap-4 text-white/60">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={20} className="text-green-500" />
                </div>
                <p className="text-sm">Acceso desde cualquier móvil</p>
              </div>
              <div className="flex items-center gap-4 text-white/60">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={20} className="text-green-500" />
                </div>
                <p className="text-sm">Historial indestructible</p>
              </div>
            </div>

            <button 
              onClick={signIn}
              className="w-full bg-white text-black font-black py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-taxi-yellow transition-all active:scale-95 shadow-xl"
            >
              <LogIn size={20} />
              Entrar con Google
            </button>
          </div>

          <p className="text-center text-[10px] text-white/20 uppercase tracking-widest font-mono">
            Professional Edition v2.0
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 max-w-md mx-auto px-4 pt-6">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-taxi-yellow rounded-lg overflow-hidden shadow-lg shadow-taxi-yellow/20">
            <img 
              src="/icono.png" 
              alt="TaxiMoney Icon" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">TaxiMoney</h1>
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Hola, {user.displayName?.split(' ')[0]}</p>
          </div>
        </div>
        <button 
          onClick={logOut}
          className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:text-red-400 transition-colors"
        >
          <LogOut size={18} />
        </button>
      </header>

      <main>
        <AnimatePresence mode="wait">
          {activeTab === 'turno' && (
            <motion.div
              key="turno"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Main Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-card p-4 rounded-2xl">
                  <p className="text-[10px] uppercase text-white/40 font-mono mb-1">Caja ({config.driverPercent}%)</p>
                  <p className="text-2xl font-bold text-taxi-yellow">{formatCurrency(currentTotals.caja)}</p>
                </div>
                <div className="glass-card p-4 rounded-2xl">
                  <p className="text-[10px] uppercase text-white/40 font-mono mb-1">Propinas</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold text-orange-400">{formatCurrency(currentTotals.propinas)}</p>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] text-blue-400 font-mono">💳 {formatCurrency(currentTotals.propinaTarjeta)}</span>
                    <span className="text-[9px] text-green-400 font-mono">💵 {formatCurrency(currentTotals.propinaEfectivo)}</span>
                  </div>
                </div>

                <div className="glass-card p-4 rounded-2xl border-blue-500/20">
                  <p className="text-[10px] uppercase text-white/40 font-mono mb-1">Total Tarjeta</p>
                  <p className="text-xl font-bold text-blue-400">{formatCurrency(currentTotals.tarjeta)}</p>
                  <p className="text-[9px] text-white/30 mt-0.5">Cobrado por TPV</p>
                </div>
                <div className="glass-card p-4 rounded-2xl border-green-500/20">
                  <p className="text-[10px] uppercase text-white/40 font-mono mb-1">Total Efectivo</p>
                  <p className="text-xl font-bold text-green-400">{formatCurrency(currentTotals.efectivo + currentTotals.propinaEfectivo)}</p>
                  <p className="text-[9px] text-white/30 mt-0.5">Dinero en mano</p>
                </div>
                
                <div className="glass-card p-4 rounded-2xl bg-white/5">
                  <p className="text-[10px] uppercase text-white/40 font-mono mb-1">Mi Parte</p>
                  <p className="text-xl font-bold">{formatCurrency(currentTotals.mio)}</p>
                  <p className="text-[9px] text-white/30 mt-0.5">Base: {formatCurrency(currentTotals.miParteCaja)}</p>
                </div>
                <div className="glass-card p-4 rounded-2xl bg-white/5">
                  <p className="text-[10px] uppercase text-white/40 font-mono mb-1">Jefe</p>
                  <p className="text-xl font-bold">{formatCurrency(currentTotals.jefe)}</p>
                  <p className="text-[9px] text-white/30 mt-0.5">Porcentaje: {100 - config.driverPercent}%</p>
                </div>

                <div className={cn(
                  "col-span-2 p-4 rounded-2xl border flex items-center justify-between",
                  currentTotals.ajuste > 0 
                    ? "bg-red-500/10 border-red-500/30 text-red-400" 
                    : currentTotals.ajuste < 0 
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-white/5 border-white/10 text-white/60"
                )}>
                  <div>
                    <p className="text-[10px] uppercase font-mono opacity-70">
                      {currentTotals.ajuste > 0 ? "Debes al Jefe" : currentTotals.ajuste < 0 ? "Jefe te debe" : "Cuentas al día"}
                    </p>
                    <p className="text-lg font-bold">{formatCurrency(Math.abs(currentTotals.ajuste))}</p>
                  </div>
                  {currentTotals.ajuste !== 0 && (
                    <div className="w-10 h-10 rounded-full bg-current/10 flex items-center justify-center">
                      {currentTotals.ajuste > 0 ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
                    </div>
                  )}
                </div>
              </div>

              {/* Input Section */}
              <div className="glass-card p-5 rounded-3xl space-y-4 border-white/10">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase text-white/40 font-mono ml-1">Carrera (€)</label>
                    <input 
                      type="number" 
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xl font-bold focus:outline-none focus:border-taxi-yellow transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase text-white/40 font-mono ml-1">Propina (€)</label>
                    <input 
                      type="number" 
                      value={tipInput}
                      onChange={(e) => setTipInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xl font-bold text-orange-400 focus:outline-none focus:border-orange-400 transition-colors"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => addTrip('Tarjeta')}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-600/20"
                  >
                    <CreditCard size={20} />
                    Tarjeta
                  </button>
                  <button 
                    onClick={() => addTrip('Efectivo')}
                    className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-green-600/20"
                  >
                    <Banknote size={20} />
                    Efectivo
                  </button>
                </div>
              </div>

              {/* Trips List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-bold text-white/60">Viajes Recientes</h3>
                  <span className="text-[10px] font-mono text-white/30">{currentTrips.length} servicios</span>
                </div>
                <div className="space-y-2">
                  {currentTrips.map((trip) => (
                    <motion.div 
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={trip.id}
                      className="glass-card p-3 rounded-xl flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          trip.method === 'Tarjeta' ? "bg-blue-500/10 text-blue-400" : "bg-green-500/10 text-green-400"
                        )}>
                          {trip.method === 'Tarjeta' ? <CreditCard size={18} /> : <Banknote size={18} />}
                        </div>
                        <div>
                          <p className="font-bold">{formatCurrency(trip.amount + trip.tip)}</p>
                          <div className="flex items-center gap-2 text-[10px] text-white/40 font-mono">
                            <span>{trip.time}</span>
                            <span>•</span>
                            <span>{trip.method}</span>
                            {trip.tip > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-orange-400">+{formatCurrency(trip.tip)} prop.</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteTrip(trip.id)}
                        className="p-2 text-white/20 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </motion.div>
                  ))}
                  {currentTrips.length === 0 && (
                    <div className="text-center py-8 border-2 border-dashed border-white/5 rounded-2xl">
                      <p className="text-sm text-white/20">No hay viajes registrados hoy</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Close Shift */}
              <div className="pt-4 space-y-4">
                <div className="glass-card p-4 rounded-2xl border-white/10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-taxi-yellow/10 text-taxi-yellow flex items-center justify-center">
                      <Clock size={16} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] uppercase text-white/40 font-mono">Horas del Turno</p>
                      <input 
                        type="number" 
                        value={hoursInput}
                        onChange={(e) => setHoursInput(e.target.value)}
                        placeholder="Ej: 8.5"
                        className="w-full bg-transparent border-none p-0 text-lg font-bold focus:outline-none placeholder:text-white/10"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={closeShift}
                    className="w-full bg-taxi-yellow hover:bg-yellow-400 text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                    disabled={currentTrips.length === 0}
                  >
                    <Save size={20} />
                    Cerrar Turno y Guardar
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'resumen' && (
            <motion.div
              key="resumen"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Debt Banner */}
              <div className={cn(
                "p-6 rounded-3xl text-center space-y-2 shadow-2xl",
                debt > 0.01 
                  ? "bg-green-600 shadow-green-600/20" 
                  : debt < -0.01 
                  ? "bg-red-600 shadow-red-600/20"
                  : "bg-white/5 border border-white/10"
              )}>
                <p className="text-[10px] uppercase tracking-widest font-mono opacity-60">Saldo Acumulado</p>
                <h2 className="text-4xl font-black">
                  {debt > 0.01 ? "TE DEBEN" : debt < -0.01 ? "DEBES" : "AL DÍA"}
                </h2>
                <p className="text-2xl font-bold">{formatCurrency(Math.abs(debt))}</p>
                {Math.abs(debt) > 0.01 && (
                  <button 
                    onClick={resetDebt}
                    className="mt-4 w-full bg-black/20 hover:bg-black/30 py-2 rounded-lg text-xs font-bold transition-colors"
                  >
                    Saldar Cuentas
                  </button>
                )}
              </div>

              {/* Monthly Stats */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white/60 px-1">Historial de Turnos</h3>
                <div className="space-y-3">
                  {history.map((shift) => (
                    <div key={shift.id} className="glass-card p-4 rounded-2xl border-white/5 space-y-3 relative group">
                      <button 
                        onClick={() => deleteShift(shift.id)}
                        className="absolute top-4 right-4 p-2 text-white/20 hover:text-red-400 active:text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className="flex justify-between items-start pr-8">
                        <div>
                          <p className="font-bold text-lg">{shift.date}</p>
                          <p className="text-[10px] text-white/40 font-mono uppercase">{shift.month}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-taxi-yellow">{formatCurrency(shift.totals.caja)}</p>
                          <p className="text-[10px] text-white/40 font-mono">CAJA TOTAL</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
                        <div>
                          <p className="text-[9px] text-white/30 uppercase font-mono">Mi Parte</p>
                          <p className="text-sm font-bold text-green-400">{formatCurrency(shift.totals.mio)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-white/30 uppercase font-mono">Horas</p>
                          <p className="text-sm font-bold">{shift.hours}h</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-white/30 uppercase font-mono">Media/h</p>
                          <p className="text-sm font-bold text-taxi-yellow">
                            {formatCurrency(shift.totals.mio / shift.hours)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {history.length === 0 && (
                    <div className="text-center py-12">
                      <History size={48} className="mx-auto text-white/5 mb-4" />
                      <p className="text-sm text-white/20">No hay historial guardado</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'stats' && (
            <motion.div
              key="stats"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="glass-card p-6 rounded-3xl border-white/10">
                <h3 className="text-sm font-bold text-white/60 mb-6 flex items-center gap-2">
                  <TrendingUp size={18} className="text-taxi-yellow" />
                  Evolución Mensual (Caja)
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                      <XAxis 
                        dataKey="month" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#ffffff40', fontSize: 10 }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#ffffff40', fontSize: 10 }}
                        tickFormatter={(value) => `€${value}`}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #ffffff10', borderRadius: '12px' }}
                        itemStyle={{ color: '#FFD700' }}
                        cursor={{ fill: '#ffffff05' }}
                      />
                      <Bar dataKey="caja" radius={[4, 4, 0, 0]}>
                        {monthlyData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill="#FFD700" fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="glass-card p-6 rounded-3xl border-white/10">
                <h3 className="text-sm font-bold text-white/60 mb-6 flex items-center gap-2">
                  <Banknote size={18} className="text-orange-400" />
                  Propinas por Mes
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                      <XAxis 
                        dataKey="month" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#ffffff40', fontSize: 10 }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#ffffff40', fontSize: 10 }}
                        tickFormatter={(value) => `€${value}`}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #ffffff10', borderRadius: '12px' }}
                        itemStyle={{ color: '#fb923c' }}
                        cursor={{ fill: '#ffffff05' }}
                      />
                      <Bar dataKey="propinas" radius={[4, 4, 0, 0]}>
                        {monthlyData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill="#fb923c" fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {history.length === 0 && (
                <div className="text-center py-12 glass-card rounded-3xl border-white/5">
                  <BarChart3 size={48} className="mx-auto text-white/5 mb-4" />
                  <p className="text-sm text-white/20">Cierra turnos para ver estadísticas</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'ajustes' && (
            <motion.div
              key="ajustes"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="glass-card p-6 rounded-3xl border-white/10 space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-taxi-yellow/10 text-taxi-yellow flex items-center justify-center">
                    <TrendingUp size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold">Configuración de Reparto</h3>
                    <p className="text-xs text-white/40">Ajusta el porcentaje de tus ganancias</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="text-sm font-medium text-white/60">Tu Porcentaje (%)</label>
                    <span className="text-3xl font-black text-taxi-yellow">{config.driverPercent}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="99" 
                    value={config.driverPercent}
                    onChange={(e) => setConfig({ ...config, driverPercent: parseInt(e.target.value) })}
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-taxi-yellow"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-white/20 uppercase">
                    <span>Conductor</span>
                    <span>Jefe ({100 - config.driverPercent}%)</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                  <p className="text-xs text-white/60 leading-relaxed">
                    Este porcentaje se aplicará a la <span className="text-white font-bold">Caja</span> de tus próximos viajes. Las propinas siempre se suman íntegras a tu parte.
                  </p>
                </div>
              </div>

              <div className="glass-card p-6 rounded-3xl border-white/10 space-y-4 bg-gradient-to-br from-taxi-yellow/5 to-transparent">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-taxi-yellow/10 text-taxi-yellow flex items-center justify-center">
                    <Plus size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold">Espacio Publicitario</h3>
                    <p className="text-xs text-white/40">Anuncia tu negocio aquí</p>
                  </div>
                </div>
                <div className="aspect-[16/5] w-full bg-white/5 rounded-2xl border border-dashed border-white/10 flex items-center justify-center group cursor-pointer hover:bg-white/10 transition-all">
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-widest text-white/20 font-mono group-hover:text-taxi-yellow transition-colors">Tu Anuncio Aquí</p>
                    <p className="text-[8px] text-white/10 mt-1">Contacta: info@taximoney.app</p>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 rounded-3xl border-white/10 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center">
                    <Banknote size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold">Apoya el Proyecto</h3>
                    <p className="text-xs text-white/40">Si la app te ayuda, ¡invítame a un café!</p>
                  </div>
                </div>
                <a 
                  href="https://www.paypal.com/donate/?business=blca05@hotmail.com&currency_code=EUR"
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-full bg-orange-500 hover:bg-orange-400 text-white py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  ☕ Invitar a un café (PayPal)
                </a>
              </div>

              <div className="glass-card p-6 rounded-3xl border-white/10 space-y-4">
                <h3 className="font-bold flex items-center gap-2">
                  <Download size={18} className="text-blue-400" />
                  Exportar Datos
                </h3>
                <p className="text-xs text-white/40">Descarga tu historial completo en formato CSV para Excel.</p>
                <button 
                  onClick={exportToCSV}
                  className="w-full bg-white/5 hover:bg-white/10 py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  Descargar Historial (.csv)
                </button>
              </div>

              <div className="text-center pt-8">
                <p className="text-[10px] text-white/20 uppercase tracking-widest font-mono">TaxiMoney Pro v2.0</p>
                <p className="text-[9px] text-white/10 mt-1">Diseñado para máxima eficiencia en el turno</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modal System */}
      <AnimatePresence>
        {modal.show && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModal({ ...modal, show: false })}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="glass-card w-full max-w-xs p-6 rounded-3xl border-white/10 relative z-10 shadow-2xl"
            >
              <h4 className="text-lg font-bold mb-2">{modal.title}</h4>
              <p className="text-sm text-white/60 mb-6 leading-relaxed">{modal.message}</p>
              
              <div className="flex gap-3">
                {modal.type === 'confirm' ? (
                  <>
                    <button 
                      onClick={() => setModal({ ...modal, show: false })}
                      className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-bold transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={modal.onConfirm}
                      className="flex-1 py-3 rounded-xl bg-taxi-yellow text-black text-sm font-bold transition-colors shadow-lg shadow-taxi-yellow/20"
                    >
                      Confirmar
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => setModal({ ...modal, show: false })}
                    className="w-full py-3 rounded-xl bg-taxi-yellow text-black text-sm font-bold transition-colors shadow-lg shadow-taxi-yellow/20"
                  >
                    Entendido
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-6 left-4 right-4 h-16 glass-card rounded-2xl border-white/10 flex items-center justify-around px-2 shadow-2xl z-50">
        <button 
          onClick={() => setActiveTab('turno')}
          className={cn(
            "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all",
            activeTab === 'turno' ? "text-taxi-yellow bg-taxi-yellow/10" : "text-white/40 hover:text-white/60"
          )}
        >
          <LayoutDashboard size={20} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Turno</span>
        </button>
        <button 
          onClick={() => setActiveTab('resumen')}
          className={cn(
            "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all",
            activeTab === 'resumen' ? "text-taxi-yellow bg-taxi-yellow/10" : "text-white/40 hover:text-white/60"
          )}
        >
          <History size={20} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Resumen</span>
        </button>
        <button 
          onClick={() => setActiveTab('stats')}
          className={cn(
            "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all",
            activeTab === 'stats' ? "text-taxi-yellow bg-taxi-yellow/10" : "text-white/40 hover:text-white/60"
          )}
        >
          <BarChart3 size={20} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Estadísticas</span>
        </button>
        <button 
          onClick={() => setActiveTab('ajustes')}
          className={cn(
            "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all",
            activeTab === 'ajustes' ? "text-taxi-yellow bg-taxi-yellow/10" : "text-white/40 hover:text-white/60"
          )}
        >
          <Settings size={20} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Ajustes</span>
        </button>
      </nav>
    </div>
  );
}
