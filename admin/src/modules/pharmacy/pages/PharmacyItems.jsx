import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaPills, FaPlus, FaSearch } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Input, Page, PageHeader, Segmented } from "../../../components/ui";
import { pharmacyGet, errorText, money, stockText, itemTitle } from "../api";
import { usePharmacyAccess } from "../useAccess";
import ItemForm from "../components/ItemForm";

// All items: search by name, salt or barcode (a scanner types the code and Enter).
// Managers add and edit items; stock comes from purchases.
const PharmacyItems = () => {
  const allowed = usePharmacyAccess();
  const canManage = allowed("manageStock");
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [adding, setAdding] = useState(false);
  const latest = useRef(0);

  const query = useCallback(
    (cursor) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (filter === "low") params.set("lowStock", "true");
      if (filter === "off") params.set("active", "false");
      if (filter === "all") params.set("active", "true");
      if (cursor) params.set("cursor", cursor);
      return pharmacyGet(`/products?${params}`);
    },
    [q, filter]
  );

  // Typing waits a moment; an older answer never replaces a newer one
  useEffect(() => {
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const data = await query();
        if (id !== latest.current) return;
        setRows(data.products);
        setNextCursor(data.nextCursor);
      } catch (e) {
        if (id === latest.current) {
          toast.error(errorText(e));
          setRows([]);
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await query(nextCursor);
      setRows((r) => [...r, ...data.products]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  // Scanner: an exact barcode opens the item
  const onKeyDown = (e) => {
    if (e.key === "Enter" && rows?.length === 1 && rows[0].barcodes?.includes(q.trim())) navigate(`/pharmacy/items/${rows[0]._id}`);
  };

  return (
    <Page>
      <PageHeader
        title="Items"
        icon={<FaPills />}
        description="Medicines and everything else the pharmacy sells. Stock is added by entering purchases."
        actions={canManage && <Button variant="primary" icon={<FaPlus />} onClick={() => setAdding(true)}>Add item</Button>}
      />
      <Card className="mb-4" padded={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              aria-label="Search items"
              placeholder="Name, salt or scan a barcode"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              className="pl-9"
              autoFocus
            />
          </div>
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "In use" },
              { value: "low", label: "Low stock" },
              { value: "off", label: "Turned off" },
            ]}
          />
        </div>
      </Card>

      <Card padded={false}>
        {rows === null ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FaPills />}
            title={q ? "No item matches" : filter === "low" ? "Nothing is low on stock" : "No items yet"}
            description={canManage && !q && filter === "all" ? "Add the items you sell, then enter a purchase to put them in stock." : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((p) => {
                const low = p.stockUnits <= p.reorderLevelUnits;
                return (
                  <li key={p._id}>
                    <Link to={`/pharmacy/items/${p._id}`} className="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{itemTitle(p)}</p>
                        <p className="truncate text-sm text-slate-600">{[p.salt, p.manufacturer].filter(Boolean).join(" · ") || " "}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm sm:justify-end">
                        <span className="text-slate-700">
                          {money(p.unitPricePaisa)} / {p.unitName}
                          {p.packName && p.unitsPerPack > 1 && <span className="text-slate-500"> · {money(p.packPricePaisa)} / {p.packName}</span>}
                        </span>
                        {p.stockUnits <= 0 ? (
                          <Badge tone="danger">Out of stock</Badge>
                        ) : low ? (
                          <Badge tone="warning">{stockText(p.stockUnits, p)} · low</Badge>
                        ) : (
                          <Badge tone="success">{stockText(p.stockUnits, p)}</Badge>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {nextCursor && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button size="sm" onClick={loadMore} loading={loadingMore}>Show more</Button>
              </div>
            )}
          </>
        )}
      </Card>

      {adding && <ItemForm onClose={() => setAdding(false)} onSaved={(p) => navigate(`/pharmacy/items/${p._id}`)} />}
    </Page>
  );
};

export default PharmacyItems;
