import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FaCashRegister, FaMinus, FaPause, FaPlus, FaPrescriptionBottleAlt, FaSearch, FaTrash } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Page, Segmented, useDialog } from "../../../components/ui";
import { useAppConfig } from "../../../appConfig";
import { pharmacyGet, pharmacyPost, errorText, money, toPaisa, stockText, itemTitle, newRequestId } from "../api";
import { linePrice, cashSuggestions } from "../pricing";
import { openReceiptWindow, printSaleReceipt, shopNameOf } from "../receipt";
import { usePharmacyAccess } from "../useAccess";
import OpenShift from "../components/OpenShift";
import CustomerPicker from "../components/CustomerPicker";

// The sales counter. Find items by name, salt or a scanned barcode; sell full
// packs or loose units; take cash with the change worked out; print the bill.
// Keys: F2 search, F9 pay, Esc closes a list.
// The bill being made is kept on this computer until it's paid, with one request id:
// if the connection drops after paying, paying again never charges twice.
const CART_KEY = "pharmacy.counterCart";
// rx: the doctor's prescription this bill dispenses (each bill line may carry rxLine,
// the prescription line it is for)
const emptyCart = () => ({ lines: [], discount: "", method: "cash", cash: "", customer: null, rx: null, requestId: newRequestId() });
const readCart = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "null");
    return saved?.lines && saved.requestId ? saved : emptyCart();
  } catch {
    return emptyCart();
  }
};

// What the counter keeps about an item (prices for the screen; the server re-prices)
const cartProduct = (p) => ({
  productId: p._id,
  name: itemTitle(p),
  unitName: p.unitName,
  packName: p.packName,
  unitsPerPack: p.unitsPerPack,
  unitPricePaisa: p.unitPricePaisa,
  packPricePaisa: p.packPricePaisa,
  stockUnits: p.stockUnits,
  salt: p.salt,
});

const PharmacyCounter = () => {
  const config = useAppConfig();
  const allowed = usePharmacyAccess();
  const { prompt, confirm } = useDialog();
  const [params, setParams] = useSearchParams();
  const [pickFor, setPickFor] = useState(null); // a prescription line waiting for its item
  const [shift, setShift] = useState(undefined); // undefined loading, null none
  const [cart, setCart] = useState(readCart);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [active, setActive] = useState(0);
  const [subsFor, setSubsFor] = useState(null);
  const [problems, setProblems] = useState({}); // productId -> message
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // the sale just made
  const [approval, setApproval] = useState(false);
  const [held, setHeld] = useState(null);
  const search = useRef(null);
  const latest = useRef(0);
  const shopName = shopNameOf(config);

  // "Dispense" in the prescription queue opens the counter with ?rx=<id>: the
  // prescribed items go into the bill, what is left to give of each
  useEffect(() => {
    const id = params.get("rx");
    if (!id || shift === undefined || shift === null) return;
    setParams({}, { replace: true });
    (async () => {
      try {
        const { prescription: rx } = await pharmacyGet(`/prescriptions/${id}`);
        if (!["waiting", "partly"].includes(rx.status)) return toast.error(`Rx-${rx.rxNo} isn't open any more`);
        if (cart.lines.length && !(await confirm({ title: "Replace the bill?", message: "The items in the bill now are removed. Hold it first to keep them.", confirmLabel: "Replace" }))) return;
        const products = await Promise.all(rx.items.map((m) => (m.productId ? pharmacyGet(`/products/${m.productId}`).then((d) => d.product).catch(() => null) : null)));
        const lines = [];
        rx.items.forEach((m, i) => {
          const left = Math.max(1, m.qtyUnits || 1) - (m.dispensedUnits || 0);
          const p = products[i];
          if (p && p.active && left > 0 && !lines.some((l) => l.productId === p._id)) lines.push({ ...cartProduct(p), qtyUnits: left, rxLine: i });
        });
        setCart({ ...emptyCart(), lines, rx: { id: rx._id, rxNo: rx.rxNo, patient: rx.patient, doctor: rx.doctor, items: rx.items } });
        setPickFor(null);
      } catch (e) {
        toast.error(errorText(e));
      }
    })();
  }, [params, shift]); // eslint-disable-line react-hooks/exhaustive-deps

  const dropRx = () => {
    setCart((c) => ({ ...c, rx: null, lines: c.lines.map((l) => ({ ...l, rxLine: undefined })) }));
    setPickFor(null);
  };
  const pickItemFor = (i) => {
    setPickFor(i);
    setQ(cart.rx.items[i].name);
    search.current?.focus();
  };

  useEffect(() => {
    pharmacyGet("/shifts/current")
      .then((d) => setShift(d.shift))
      .catch((e) => {
        toast.error(errorText(e));
        setShift(null);
      });
  }, []);

  useEffect(() => {
    try {
      if (cart.lines.length) localStorage.setItem(CART_KEY, JSON.stringify(cart));
      else localStorage.removeItem(CART_KEY);
    } catch {
      // private window: the bill just isn't kept
    }
  }, [cart]);

  // Search as you type; an older answer never replaces a newer one
  useEffect(() => {
    const text = q.trim();
    const id = ++latest.current;
    if (!text) return setFound([]);
    const timer = setTimeout(() => {
      pharmacyGet(`/products?active=true&limit=8&q=${encodeURIComponent(text)}`)
        .then((d) => {
          if (id !== latest.current) return;
          setFound(d.products);
          setActive(0);
        })
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  const update = (patch) => setCart((c) => ({ ...c, ...patch }));
  const setQty = (productId, qtyUnits) => {
    setProblems((p) => ({ ...p, [productId]: undefined }));
    setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.productId === productId ? { ...l, qtyUnits: Math.max(1, qtyUnits) } : l)) }));
  };
  const remove = (productId) => setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.productId !== productId) }));

  // Adding an item already in the bill adds one more unit
  // While a prescription line waits for its item, the item added is for that line
  const add = (p) => {
    const forLine = pickFor !== null && cart.rx ? pickFor : undefined;
    const qtyFor = forLine !== undefined ? Math.max(1, (cart.rx.items[forLine].qtyUnits || 1) - (cart.rx.items[forLine].dispensedUnits || 0)) : 1;
    setCart((c) => {
      const there = c.lines.find((l) => l.productId === p._id);
      return there
        ? { ...c, lines: c.lines.map((l) => (l.productId === p._id ? { ...l, qtyUnits: l.qtyUnits + qtyFor, rxLine: l.rxLine ?? forLine } : l)) }
        : { ...c, lines: [...c.lines, { ...cartProduct(p), qtyUnits: qtyFor, ...(forLine !== undefined && { rxLine: forLine }) }] };
    });
    setPickFor(null);
    setQ("");
    setFound([]);
    setSubsFor(null);
    search.current?.focus();
  };

  const onSearchKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, found.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const exact = found.find((p) => p.barcodes?.includes(q.trim()));
      if (exact) add(exact);
      else if (found[active]) add(found[active]);
    } else if (e.key === "Escape") {
      setQ("");
      setFound([]);
    }
  };

  const showSubstitutes = async (p) => {
    try {
      setSubsFor({ product: p, list: (await pharmacyGet(`/products/${p._id}/substitutes`)).substitutes });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const subtotal = useMemo(() => cart.lines.reduce((s, l) => s + linePrice(l, l.qtyUnits), 0), [cart.lines]);
  const discount = toPaisa(cart.discount);
  const total = subtotal - (discount || 0);
// Cash: handed over (empty: exact). Khata: paid now (empty: nothing), the rest on the account.
  const onKhata = cart.method === "account";
  const cashPaisa = cart.method === "cash" ? (cart.cash.trim() ? toPaisa(cart.cash) : total) : onKhata ? (cart.cash.trim() ? toPaisa(cart.cash) : 0) : total;
  const change = cashPaisa !== null && !onKhata ? cashPaisa - total : 0;
  const khataPaisa = onKhata && cashPaisa !== null ? total - cashPaisa : 0;
  const canPay =
    cart.lines.length > 0 && discount !== null && total >= 0 && cashPaisa !== null && change >= 0 && (!onKhata || (cart.customer && khataPaisa >= 0)) && !busy;

  const pay = useCallback(
    async ({ allowNegative = false, managerApproval } = {}) => {
      if (!canPay) return;
      let printWin = null;
      try {
        if (localStorage.getItem("pharmacy.autoPrint") === "true") printWin = openReceiptWindow();
      } catch {
        // no setting
      }
      setBusy(true);
      setProblems({});
      try {
        const data = await pharmacyPost("/sales", {
          items: cart.lines.map((l) => ({ productId: l.productId, qtyUnits: l.qtyUnits, ...(cart.rx && Number.isInteger(l.rxLine) && { rxLine: l.rxLine }) })),
          ...(cart.rx && { prescriptionId: cart.rx.id }),
          discountPaisa: discount || 0,
          paymentMethod: cart.method,
          ...((cart.method === "cash" || onKhata) && { cashReceivedPaisa: cashPaisa }),
          ...(cart.customer && { customerId: cart.customer._id }),
          expectedTotalPaisa: total,
          requestId: cart.requestId,
          ...(allowNegative && { allowNegative: true }),
          ...(managerApproval && { managerApproval }),
        });
        setDone(data.sale);
        if (cart.rx) toast.success(`Rx-${cart.rx.rxNo} for ${cart.rx.patient?.name}: dispensed`);
        setApproval(false);
        setCart(emptyCart());
        if (printWin) printSaleReceipt(data.sale, shopName, printWin);
        pharmacyGet("/shifts/current").then((d) => setShift(d.shift)).catch(() => {});
      } catch (e) {
        printWin?.close();
        const body = e?.response?.data;
        if (body?.code === "insufficient_stock") {
          setProblems({ [body.productId]: body.message });
          toast.error(body.message);
        } else if (body?.code === "price_changed") {
          // Fresh prices for every line, then the cashier checks the new total
          const fresh = await Promise.all(cart.lines.map((l) => pharmacyGet(`/products/${l.productId}`).then((d) => d.product).catch(() => null)));
          setCart((c) => ({ ...c, lines: c.lines.map((l, i) => (fresh[i] ? { ...cartProduct(fresh[i]), qtyUnits: l.qtyUnits, rxLine: l.rxLine } : l)) }));
          toast.warn(`${body.message} New total: ${money(body.totalPaisa)}`);
        } else if (body?.code === "no_shift") {
          setShift(null);
          toast.error(body.message);
        } else if (body?.code === "rx_not_open") {
          dropRx();
          toast.error(`${body.message}. It was taken off this bill.`);
        } else if (body?.code === "approval_refused" || body?.code === "credit_limit") {
          toast.error(body.message);
        } else if (!e?.response) {
          toast.error("Couldn't reach the server. Press Pay again: the bill won't be charged twice.");
        } else {
          toast.error(errorText(e));
        }
      } finally {
        setBusy(false);
      }
    },
    [canPay, cart, discount, cashPaisa, total, shopName, onKhata]
  );

  // Keyboard: F9 pays, F2 goes to search
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F9") {
        e.preventDefault();
        if (!done) pay();
      } else if (e.key === "F2") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pay, done]);

  const hold = async () => {
    const label = await prompt({ title: "Hold this bill", message: "It shows at every counter until someone picks it up.", label: "Customer (optional)", placeholder: "e.g. Man in blue shirt", confirmLabel: "Hold" });
    if (label === null) return;
    try {
      const data = await pharmacyPost("/held", { label, items: cart.lines.map((l) => ({ productId: l.productId, qtyUnits: l.qtyUnits })) });
      toast.success(data.message);
      setCart(emptyCart());
      search.current?.focus();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const openHeld = async () => {
    try {
      setHeld((await pharmacyGet("/held")).held);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const pickUp = async (h) => {
    try {
      const { held: bill } = await pharmacyPost(`/held/${h._id}/take`);
      const products = await Promise.all(bill.items.map((i) => pharmacyGet(`/products/${i.productId}`).then((d) => d.product).catch(() => null)));
      setCart((c) => {
        let lines = c.lines;
        bill.items.forEach((item, i) => {
          if (!products[i]) return;
          lines = lines.some((l) => l.productId === item.productId)
            ? lines.map((l) => (l.productId === item.productId ? { ...l, qtyUnits: l.qtyUnits + item.qtyUnits } : l))
            : [...lines, { ...cartProduct(products[i]), qtyUnits: item.qtyUnits }];
        });
        return { ...c, lines };
      });
      setHeld(null);
      if (products.some((p) => !p)) toast.warn("An item in the held bill is no longer sold and was left out");
    } catch (e) {
      toast.error(errorText(e));
      openHeld();
    }
  };

  if (shift === undefined) return <Page><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;
  if (shift === null) return <OpenShift onOpened={setShift} />;

  const anyShort = Object.values(problems).some(Boolean);
  return (
    <Page>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <FaCashRegister className="text-primary-700" aria-hidden="true" /> Counter
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">
            Shift {shift.shiftNo} · {shift.totals?.salesCount || 0} bills · {money(shift.totals?.salesPaisa)}
          </span>
          <Button size="sm" onClick={openHeld}>Held bills</Button>
          <Link to="/pharmacy/shift" className="text-primary-700 underline">Close shift</Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <Card className="mb-3" padded={false}>
            <div className="relative p-3">
              <FaSearch className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                ref={search}
                aria-label="Find an item"
                placeholder="Name, salt or scan a barcode (F2)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onSearchKey}
                className="pl-9"
                autoComplete="off"
                autoFocus
              />
              {found.length > 0 && (
                <ul className="absolute left-3 right-3 z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Matching items">
                  {found.map((p, i) => (
                    <li key={p._id} role="option" aria-selected={i === active} className={`flex items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-primary-50" : ""}`}>
                      <button type="button" onClick={() => add(p)} onMouseEnter={() => setActive(i)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-slate-900">{itemTitle(p)}</span> <span className="text-slate-500">{p.salt}</span>
                        </span>
                        <span className="shrink-0 text-slate-700">
                          {money(p.unitPricePaisa)}
                          {p.stockUnits > 0 ? <span className="ml-2 text-slate-500">{stockText(p.stockUnits, p)}</span> : <Badge tone="danger" className="ml-2">Out of stock</Badge>}
                        </span>
                      </button>
                      {p.salt && (
                        <Button size="sm" variant="ghost" onClick={() => showSubstitutes(p)}>Substitutes</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {cart.rx && (
            <Card className="mb-3 border-primary-200 bg-primary-50/40" aria-label="Prescription">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-medium text-slate-900">
                  <FaPrescriptionBottleAlt className="text-primary-700" aria-hidden="true" />
                  Rx-{cart.rx.rxNo} · {cart.rx.patient?.name} <span className="text-sm font-normal text-slate-600">Dr. {cart.rx.doctor?.name}</span>
                </p>
                <Button size="sm" variant="ghost" onClick={dropRx}>Not for this prescription</Button>
              </div>
              <ul className="space-y-1 text-sm">
                {cart.rx.items.map((m, i) => {
                  const inBill = cart.lines.find((l) => l.rxLine === i);
                  return (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {[m.name, m.strength].filter(Boolean).join(" ")}
                        <span className="text-slate-500">{[m.dose, m.days && `${m.days} days`, m.qtyUnits && `give ${m.qtyUnits}`, m.dispensedUnits && `${m.dispensedUnits} given before`].filter(Boolean).map((t) => ` · ${t}`).join("")}</span>
                      </span>
                      {inBill ? (
                        <Badge tone="success">In the bill: {inBill.name}</Badge>
                      ) : pickFor === i ? (
                        <Badge tone="info">Choose the item above</Badge>
                      ) : (
                        <Button size="sm" onClick={() => pickItemFor(i)}>Pick an item</Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {subsFor && (
            <Card className="mb-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900">Instead of {itemTitle(subsFor.product)} ({subsFor.product.salt} {subsFor.product.strength})</p>
                <Button size="sm" variant="ghost" onClick={() => setSubsFor(null)}>Close</Button>
              </div>
              {subsFor.list.length === 0 ? (
                <p className="text-sm text-slate-600">No other brand with the same salt and strength.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {subsFor.list.map((s) => (
                    <li key={s._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>{itemTitle(s)} <span className="text-slate-500">{s.manufacturer}</span></span>
                      <span className="flex items-center gap-2">
                        {money(s.unitPricePaisa)} · {s.stockUnits > 0 ? stockText(s.stockUnits, s) : "out of stock"}
                        <Button size="sm" onClick={() => add(s)} disabled={s.stockUnits <= 0}>Add</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card padded={false}>
            {cart.lines.length === 0 ? (
              <EmptyState icon={<FaCashRegister />} title="New bill" description="Search or scan an item to start." />
            ) : (
              <ul className="divide-y divide-slate-100" aria-label="Bill">
                {cart.lines.map((l) => {
                  const per = l.unitsPerPack || 1;
                  const packs = l.packName && per > 1;
                  return (
                    <li key={l.productId} className="px-4 py-3" aria-label={l.name}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{l.name}</p>
                          <p className="text-xs text-slate-500">
                            {money(l.unitPricePaisa)} / {l.unitName}
                            {packs && ` · ${money(l.packPricePaisa)} / ${l.packName} of ${per}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <IconButton label={`One less ${l.unitName}`} icon={<FaMinus />} onClick={() => setQty(l.productId, l.qtyUnits - 1)} disabled={l.qtyUnits <= 1} />
                          <Input
                            aria-label={`${l.name} quantity (${l.unitName}s)`}
                            type="number"
                            min="1"
                            inputMode="numeric"
                            value={l.qtyUnits}
                            onChange={(e) => setQty(l.productId, Math.floor(Number(e.target.value) || 1))}
                            className="w-20 text-center"
                          />
                          <IconButton label={`One more ${l.unitName}`} icon={<FaPlus />} onClick={() => setQty(l.productId, l.qtyUnits + 1)} />
                          {packs && (
                            <Button size="sm" onClick={() => setQty(l.productId, l.qtyUnits === 1 ? per : l.qtyUnits + per)}>
                              +1 {l.packName}
                            </Button>
                          )}
                          <span className="w-24 text-right font-semibold tabular-nums text-slate-900">{money(linePrice(l, l.qtyUnits))}</span>
                          <IconButton label={`Remove ${l.name}`} icon={<FaTrash />} tone="danger" onClick={() => remove(l.productId)} />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{stockText(l.qtyUnits, l)}</p>
                      {problems[l.productId] && <p className="mt-1 text-sm text-red-700" role="alert">{problems[l.productId]}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-4">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
          </dl>
          <Field label="Discount (Rs)" htmlFor="co-discount" className="mt-2" error={discount === null ? "Enter an amount like 50" : discount > subtotal ? "More than the bill" : undefined}>
            <Input id="co-discount" inputMode="decimal" value={cart.discount} onChange={(e) => update({ discount: e.target.value })} />
          </Field>
          <div className="my-3 flex items-baseline justify-between border-y border-slate-100 py-3">
            <span className="text-slate-700">Total</span>
            <span className="text-3xl font-bold tabular-nums text-slate-900" data-testid="counter-total">{money(Math.max(0, total))}</span>
          </div>
          <Segmented
            label="Payment"
            value={cart.method}
            onChange={(method) => update({ method })}
            options={[
              { value: "cash", label: "Cash" },
              { value: "card", label: "Card" },
              { value: "online", label: "Online" },
              { value: "account", label: "Khata" },
            ]}
          />
          {onKhata && (
            <>
              <Field label="Paid now (Rs)" htmlFor="co-paidnow" className="mt-3" hint="Empty: all on the khata" error={cashPaisa === null ? "Enter an amount" : khataPaisa < 0 ? "More than the bill" : undefined}>
                <Input id="co-paidnow" inputMode="decimal" value={cart.cash} onChange={(e) => update({ cash: e.target.value })} />
              </Field>
              {!cart.customer && <p className="mt-2 text-sm text-amber-800">Choose the customer below.</p>}
              {cart.customer && khataPaisa > 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-900" data-testid="counter-khata">
                  {money(khataPaisa)} on {cart.customer.name}’s khata
                </p>
              )}
            </>
          )}
          {cart.method === "cash" && (
            <>
              <Field label="Cash received (Rs)" htmlFor="co-cash" className="mt-3" hint="Empty: exact amount" error={cashPaisa === null ? "Enter an amount" : change < 0 ? "Less than the total" : undefined}>
                <Input id="co-cash" inputMode="decimal" value={cart.cash} onChange={(e) => update({ cash: e.target.value })} />
              </Field>
              {total > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Cash suggestions">
                  {cashSuggestions(total).map((p) => (
                    <Button key={p} size="sm" onClick={() => update({ cash: String(p / 100) })}>{money(p)}</Button>
                  ))}
                </div>
              )}
              {change > 0 && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-lg font-semibold text-emerald-800" data-testid="counter-change">
                  Change {money(change)}
                </p>
              )}
            </>
          )}
          <div className="mt-3">
            <CustomerPicker value={cart.customer} onChange={(customer) => update({ customer })} />
          </div>
          <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => pay()} loading={busy} disabled={!canPay}>
            Pay {money(Math.max(0, total))} (F9)
          </Button>
          {anyShort && (
            <Button
              variant="danger-outline"
              className="mt-2 w-full"
              onClick={() => (allowed("overrideNegativeStock") ? pay({ allowNegative: true }) : setApproval(true))}
              disabled={busy}
            >
              Sell anyway (stock not entered yet)
            </Button>
          )}
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" icon={<FaPause />} onClick={hold} disabled={!cart.lines.length || busy}>Hold</Button>
            <Button className="flex-1" onClick={() => setCart(emptyCart())} disabled={!cart.lines.length || busy}>Clear</Button>
          </div>
        </Card>
      </div>

      {done && <SaleDone sale={done} shopName={shopName} onNext={() => { setDone(null); search.current?.focus(); }} />}
      {approval && <ManagerApproval busy={busy} onClose={() => setApproval(false)} onApprove={(managerApproval) => pay({ allowNegative: true, managerApproval })} />}
      {held && (
        <Modal title="Held bills" onClose={() => setHeld(null)}>
          {held.length === 0 ? (
            <p className="text-sm text-slate-600">No bills are held.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {held.map((h) => (
                <li key={h._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-slate-900">{h.label || "No name"}</span> · {h.items.length} items · {money(h.totalPaisa)}
                    <span className="block text-xs text-slate-500">{h.by?.name} · {new Date(h.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  </span>
                  <Button size="sm" variant="primary" onClick={() => pickUp(h)}>Pick up</Button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </Page>
  );
};

// After paying: the change in large type, print, next customer (Enter)
const SaleDone = ({ sale, shopName, onNext }) => {
  const next = useRef(null);
  useEffect(() => next.current?.focus(), []);
  return (
    <Modal
      title={`Bill ${sale.saleNo} saved`}
      onClose={onNext}
      footer={
        <>
          <Button onClick={() => printSaleReceipt(sale, shopName) || toast.error("Allow pop-ups for this site to print")}>Print bill</Button>
          <Button ref={next} variant="primary" onClick={onNext}>Next customer</Button>
        </>
      }
    >
      <p className="text-slate-700">Total {money(sale.totalPaisa)}{sale.paymentMethod !== "cash" && ` · paid by ${sale.paymentMethod}`}</p>
      {sale.changePaisa > 0 && <p className="text-4xl font-bold text-emerald-700" data-testid="done-change">Change {money(sale.changePaisa)}</p>}
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          defaultChecked={(() => {
            try {
              return localStorage.getItem("pharmacy.autoPrint") === "true";
            } catch {
              return false;
            }
          })()}
          onChange={(e) => {
            try {
              localStorage.setItem("pharmacy.autoPrint", String(e.target.checked));
            } catch {
              // not kept
            }
          }}
          className="h-4 w-4"
        />
        Print every bill automatically on this computer
      </label>
    </Modal>
  );
};

// A manager allows selling stock that isn't entered yet, at the cashier's counter
const ManagerApproval = ({ busy, onClose, onApprove }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Modal
      title="Manager approval"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="approval-form" loading={busy}>Approve and sell</Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">The system shows less stock than this bill. A manager can allow it; it’s recorded with their name.</p>
      <form
        id="approval-form"
        onSubmit={(e) => {
          e.preventDefault();
          onApprove({ email, password });
        }}
        className="space-y-3"
      >
        <Field label="Manager's email" htmlFor="ap-email">
          <Input id="ap-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoFocus />
        </Field>
        <Field label="Manager's password" htmlFor="ap-password">
          <Input id="ap-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </Field>
      </form>
    </Modal>
  );
};

export default PharmacyCounter;
