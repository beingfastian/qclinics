import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FaAddressBook, FaPlus, FaSearch } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Input, Page, PageHeader, Segmented } from "../../../components/ui";
import { pharmacyGet, errorText, money } from "../api";
import { khataText } from "../components/CustomerPicker";
import CustomerForm from "../components/CustomerForm";

// Khata customers: find by name or phone, see who owes and how much in all
const PharmacyCustomers = () => {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const latest = useRef(0);

  const load = () => {
    const id = ++latest.current;
    const params = new URLSearchParams({ limit: "200" });
    if (q.trim()) params.set("q", q.trim());
    if (filter === "owing") params.set("owing", "true");
    return pharmacyGet(`/customers?${params}`)
      .then((d) => id === latest.current && setData(d))
      .catch((e) => toast.error(errorText(e)));
  };
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [q, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page narrow>
      <PageHeader
        title="Customers"
        icon={<FaAddressBook />}
        description="Khata: customers who buy on credit and pay later."
        actions={<Button variant="primary" icon={<FaPlus />} onClick={() => setAdding(true)}>Add customer</Button>}
      />
      {data?.owed && (
        <p className="mb-3 text-sm text-slate-700" data-testid="total-owed">
          {data.owed.customers} customers owe <span className="font-semibold">{money(data.owed.totalPaisa)}</span> in all
        </p>
      )}
      <Card className="mb-4" padded={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input aria-label="Search customers" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "owing", label: "Who owes" }]} />
        </div>
      </Card>
      <Card padded={false}>
        {!data ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : data.customers.length === 0 ? (
          <EmptyState icon={<FaAddressBook />} title={q ? "No customer matches" : filter === "owing" ? "Nobody owes anything" : "No customers yet"} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.customers.map((c) => (
              <li key={c._id}>
                <Link to={`/pharmacy/customers/${c._id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{c.name}</span> {!c.active && <Badge>Turned off</Badge>}
                    <span className="block truncate text-sm text-slate-600">{c.phone || " "}</span>
                  </span>
                  {c.balancePaisa > 0 ? <Badge tone="warning">{money(c.balancePaisa)}</Badge> : <span className="text-sm text-slate-500">{khataText(c)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </Page>
  );
};

export default PharmacyCustomers;
