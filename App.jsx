
import { useEffect, useState } from "react";
import "./App.css";
import riceImage from "./assets/grains/rice-photo.jpg";
import wheatImage from "./assets/grains/wheat-photo.jpg";
import maizeImage from "./assets/grains/maize-photo.jpg";
import milletImage from "./assets/grains/millets-photo.jpg";
import otherGrainImage from "./assets/grains/other-grains-photo.jpg";

const initialGrains = [
  { name: "Rice", type: "Paddy", quantity: "2,450 kg", capacity: "82%", status: "Healthy" },
  { name: "Wheat", type: "Wheat", quantity: "1,850 kg", capacity: "65%", status: "Healthy" },
  { name: "Maize", type: "Corn", quantity: "1,200 kg", capacity: "48%", status: "Warning" },
  { name: "Millets", type: "Ragi", quantity: "850 kg", capacity: "35%", status: "Healthy" },
];

const commonMonitoringGrains = [
  "Rice",
  "Wheat",
  "Maize",
  "Millets",
  "Barley",
  "Sorghum",
  "Oats",
  "Rye",
];

const storageColors = ["blue-fill", "green-fill", "purple-fill", "orange-fill"];

const grainSearchStopwords = new Set(["grain", "grains", "seed", "seeds", "the", "and"]);

function getDefaultGrainTargets(name) {
  const grainName = name.trim().toLowerCase();

  if (grainName.includes("rice") || grainName.includes("paddy")) {
    return { minTemperature: 15, minHumidity: 45 };
  }
  if (grainName.includes("wheat")) {
    return { minTemperature: 15, minHumidity: 40 };
  }
  if (grainName.includes("maize") || grainName.includes("corn")) {
    return { minTemperature: 18, minHumidity: 40 };
  }
  if (grainName.includes("millet") || grainName.includes("ragi")) {
    return { minTemperature: 18, minHumidity: 40 };
  }
  return { minTemperature: 18, minHumidity: 40 };
}

function getLocalGrainImage(name) {
  const grainName = name.trim().toLowerCase();

  if (grainName.includes("rice") || grainName.includes("paddy")) return riceImage;
  if (grainName.includes("wheat")) return wheatImage;
  if (grainName.includes("maize") || grainName.includes("corn")) return maizeImage;
  if (grainName.includes("millet") || grainName.includes("ragi")) return milletImage;
  return null;
}

function getGrainImage(name, photo) {
  return photo?.url || getLocalGrainImage(name) || otherGrainImage;
}

function getMetadataText(value) {
  if (typeof value !== "string") return "";
  return new DOMParser().parseFromString(value, "text/html").body.textContent
    .replace(/\s+/g, " ")
    .trim();
}

async function searchCommonsPhoto(grainName, signal) {
  const searchTokens = grainName.toLowerCase().match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => !grainSearchStopwords.has(token))
    .map((token) => token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token) || [];
  if (searchTokens.length === 0) return null;

  for (const photoTerm of ["seeds", "grain"]) {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `filetype:bitmap "${grainName}" ${photoTerm}`,
      gsrnamespace: "6",
      gsrlimit: "10",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "500",
      format: "json",
      origin: "*",
    });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal });
    if (!response.ok) {
      throw new Error("Wikimedia Commons image search failed. Check your internet connection.");
    }

    const result = await response.json();
    const pages = Object.values(result.query?.pages || {})
      .sort((left, right) => left.index - right.index);
    const candidates = [];

    for (const page of pages) {
      const imageInfo = page.imageinfo?.[0];
      const metadata = imageInfo?.extmetadata;
      if (!imageInfo?.thumburl || !imageInfo.descriptionurl || !metadata?.LicenseShortName?.value) {
        continue;
      }

      const titleText = page.title.toLowerCase();
      const descriptionText = getMetadataText(metadata.ImageDescription?.value).toLowerCase();
      const categoryText = getMetadataText(metadata.Categories?.value).replace(/\|/g, " ").toLowerCase();
      const searchText = `${titleText} ${descriptionText} ${categoryText}`;
      if (!searchTokens.every((token) => searchText.includes(token))) continue;

      const imageUrl = new URL(imageInfo.thumburl);
      const sourceUrl = new URL(imageInfo.descriptionurl);
      if (
        imageUrl.protocol !== "https:"
        || !["thumb.wikimedia.org", "upload.wikimedia.org"].includes(imageUrl.hostname)
        || sourceUrl.protocol !== "https:"
        || sourceUrl.hostname !== "commons.wikimedia.org"
      ) {
        continue;
      }

      const artist = getMetadataText(metadata.Artist?.value);
      const license = getMetadataText(metadata.LicenseShortName.value);
      if (!artist || !license) continue;

      const titleMatches = searchTokens.filter((token) => titleText.includes(token)).length;
      const descriptionMatches = searchTokens.filter((token) => descriptionText.includes(token)).length;
      candidates.push({
        index: page.index,
        score: titleMatches * 4 + descriptionMatches * 2,
        photo: {
          query: grainName,
          url: imageUrl.toString(),
          title: page.title.replace(/^File:/, ""),
          artist,
          license,
          sourceUrl: sourceUrl.toString(),
        },
      });
    }

    candidates.sort((left, right) => right.score - left.score || left.index - right.index);
    if (candidates[0]) return candidates[0].photo;
  }

  return null;
}

function getQuantityInKg(quantity) {
  return Number(String(quantity).replace(/,/g, "").replace(/[^\d.]/g, "")) || 0;
}

const iconShapes = {
  brand: <><path d="M12 2.8 20 6v5.6c0 4.6-3 7.6-8 9.6-5-2-8-5-8-9.6V6l8-3.2Z" /><path d="M12 16V8" /><path d="M12 11c-2.4 0-3.8-1.3-3.8-3.2 2.4 0 3.8 1.3 3.8 3.2Z" /><path d="M12 13c2.4 0 3.8-1.3 3.8-3.2-2.4 0-3.8 1.3-3.8 3.2Z" /></>,
  dashboard: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></>,
  inventory: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
  storage: <><path d="M3 21V8l9-5 9 5v13" /><path d="M3 10h18" /><path d="M8 21v-7h8v7" /></>,
  monitoring: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  reports: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
  logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  thermometer: <><path d="M14 14.8V5a3 3 0 0 0-6 0v9.8a5 5 0 1 0 6 0Z" /><path d="M11 11v7" /></>,
  humidity: <><path d="M12 22a7 7 0 0 0 7-7c0-4-7-13-7-13S5 11 5 15a7 7 0 0 0 7 7Z" /><path d="M9 16a3 3 0 0 0 3 3" /></>,
  alert: <><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
};

function Icon({ name, size = 18 }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconShapes[name]}
    </svg>
  );
}

function GrainTable({ grains }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>GRAIN NAME</th>
            <th>QUANTITY</th>
            <th>CAPACITY</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {grains.map((grain) => (
            <tr key={grain.name}>
              <td>
                <div className="grain-cell">
                  <img className="grain-thumbnail" src={getGrainImage(grain.name, grain.photo)} alt="" />
                  <div>
                    <strong>{grain.name}</strong>
                    <span className="sub-cell">{grain.type}</span>
                    {grain.photo && (
                      <a
                        className="photo-credit"
                        href={grain.photo.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Photo: {grain.photo.artist} · {grain.photo.license}
                      </a>
                    )}
                  </div>
                </div>
              </td>
              <td>
                <strong>{grain.quantity}</strong>
                {grain.lastStockAddition && (
                  <span className="sub-cell">
                    Previous {grain.lastStockAddition.previousQuantity} · Added {grain.lastStockAddition.addedQuantity}
                  </span>
                )}
              </td>
              <td>
                <div className="progress-cell">
                  <div className="progress-track">
                    <div style={{ width: grain.capacity }} />
                  </div>
                  <span>{grain.capacity}</span>
                </div>
              </td>
              <td>
                <span className={`status ${grain.status === "Healthy" ? "healthy" : grain.status === "Pending" ? "pending" : "risk"}`}>
                  {grain.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrainStockChart({ grains }) {
  const stockData = grains.map((grain) => ({
    name: grain.name,
    quantity: getQuantityInKg(grain.quantity),
  }));
  const totalStock = stockData.reduce((total, grain) => total + grain.quantity, 0);
  const circumference = 2 * Math.PI * 48;
  const chartColors = ["#0F9D8A", "#3B82F6", "#F59E0B", "#8B5CF6", "#EF5DA8", "#06B6D4"];
  let segmentOffset = 0;
  const segments = stockData.map((grain, index) => {
    const length = totalStock > 0 ? (grain.quantity / totalStock) * circumference : 0;
    const segment = {
      ...grain,
      color: chartColors[index % chartColors.length],
      length,
      offset: segmentOffset,
    };
    segmentOffset += length;
    return segment;
  });

  return (
    <section className="report-chart" aria-labelledby="stock-chart-title">
      <div className="report-chart-heading">
        <div>
          <h4 id="stock-chart-title">Stock by grain</h4>
          <p>Current inventory quantity</p>
        </div>
        <span className="report-chart-unit">KG</span>
      </div>
      {stockData.length > 0 ? (
        <div className="report-chart-content">
          <div className="report-donut">
            <svg viewBox="0 0 120 120" role="img" aria-label="Stock distribution by grain">
              <circle cx="60" cy="60" r="48" fill="none" stroke="var(--chart-track)" strokeWidth="15" />
              {segments.map((segment) => (
                <circle
                  key={segment.name}
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="15"
                  strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                  strokeDashoffset={-segment.offset}
                  transform="rotate(-90 60 60)"
                />
              ))}
            </svg>
            <div className="report-donut-center">
              <strong>{totalStock.toLocaleString("en-US")}</strong>
              <span>kg total</span>
            </div>
          </div>
          <div className="report-stock-legend">
            {segments.map((grain) => (
              <div className="report-stock-legend-row" key={grain.name}>
                <span className="report-stock-dot" style={{ backgroundColor: grain.color }} />
                <span className="report-stock-name">{grain.name}</span>
                <strong className="report-stock-value">{grain.quantity.toLocaleString("en-US")} kg</strong>
                <span className="report-stock-share">
                  {totalStock > 0 ? `${Math.round((grain.quantity / totalStock) * 100)}%` : "0%"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="report-chart-empty">Add grains to inventory to see the stock chart.</p>
      )}
    </section>
  );
}

function AddGrainForm({ grains, onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoStatus, setPhotoStatus] = useState("idle");
  const [photoError, setPhotoError] = useState("");
  const existingGrain = grains.find((grain) => grain.name.trim().toLowerCase() === name.trim().toLowerCase());
  const localImage = getLocalGrainImage(name);
  const currentPhoto = photo?.query === name.trim() ? photo : existingGrain?.photo || null;
  const existingContainerIndex = existingGrain ? grains.indexOf(existingGrain) : -1;
  const existingContainerName = existingContainerIndex >= 0
    ? `Container ${String(existingContainerIndex + 1).padStart(2, "0")}`
    : "";

  useEffect(() => {
    const grainName = name.trim();
    if (!grainName || localImage || existingGrain?.photo) {
      setPhoto(null);
      setPhotoStatus(grainName ? existingGrain?.photo ? "found" : "local" : "idle");
      setPhotoError("");
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPhoto(null);
      setPhotoStatus("searching");
      setPhotoError("");

      try {
        const foundPhoto = await searchCommonsPhoto(grainName, controller.signal);
        if (controller.signal.aborted) return;
        if (!foundPhoto) {
          setPhotoStatus("not-found");
          return;
        }
        setPhoto(foundPhoto);
        setPhotoStatus("found");
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setPhotoStatus("error");
        setPhotoError(searchError.message || "Unable to search for a grain photo.");
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [name, localImage, existingGrain?.photo]);

  function handleSubmit(event) {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("Enter a grain name.");
      return;
    }

    const quantityInKg = Number(quantity) || 0;
    if (existingGrain && quantityInKg <= 0) {
      setError("Enter the quantity to add to this grain.");
      return;
    }

    if (!localImage && !currentPhoto) {
      setError("Wait for a matching grain photo before adding this grain.");
      return;
    }

    const capacityPercent = Number(capacity) || 0;

    onAdd({
      name: trimmedName,
      type: type.trim() || existingGrain?.type || "—",
      quantity: `${quantityInKg.toLocaleString("en-US")} kg`,
      capacity: capacity.trim()
        ? `${capacityPercent}%`
        : existingGrain?.capacity || `${capacityPercent}%`,
      status: existingGrain?.status || "Pending",
      photo: currentPhoto || null,
    });
  }

  return (
    <form className="add-grain-form" onSubmit={handleSubmit}>
      <div className="grain-preview">
        <img src={getGrainImage(name, currentPhoto)} alt="" />
        <div>
          <strong>{name.trim() || "Grain image"}</strong>
          {currentPhoto ? (
            <a className="photo-credit" href={currentPhoto.sourceUrl} target="_blank" rel="noreferrer">
              Photo: {currentPhoto.artist} · {currentPhoto.license}
            </a>
          ) : (
            <span role={photoStatus === "error" || photoStatus === "not-found" ? "alert" : "status"}>
              {photoStatus === "local"
                ? "Local grain photo"
                : photoStatus === "searching"
                  ? "Searching Wikimedia Commons..."
                  : photoStatus === "not-found"
                    ? "No matching photo found. Try a more specific grain name."
                    : photoStatus === "error"
                      ? photoError
                      : "Enter a grain name to find its photo."}
            </span>
          )}
        </div>
      </div>

      {existingGrain && (
        <p className="existing-stock-note">
          Current stock: <strong>{existingGrain.quantity}</strong> · Adding stock to <strong>{existingContainerName}</strong>
        </p>
      )}

      <div className="grain-form-fields">
        <label>
          <span className="field-label">Grain name <span aria-hidden="true">*</span></span>
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            maxLength={64}
            placeholder="e.g. Rice, Wheat, Maize"
          />
        </label>
        <label>
          Type / variety
          <input
            value={type}
            onChange={(event) => setType(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <label>
          {existingGrain ? "Quantity to add (kg)" : "Quantity (kg)"}
          <input
            type="number"
            min="0"
            step="any"
            required={Boolean(existingGrain)}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          {existingGrain ? "Updated capacity (%)" : "Capacity (%)"}
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder={existingGrain ? existingGrain.capacity : "0"}
          />
        </label>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="grain-form-actions">
        <button className="secondary-btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-btn" type="submit" disabled={!localImage && !currentPhoto}>
          {existingGrain ? "Add stock" : "Add grain"}
        </button>
      </div>
    </form>
  );
}

function StorageUnitList({ grains, onAddStock }) {
  const [activeContainer, setActiveContainer] = useState(null);
  const [stockAmount, setStockAmount] = useState("");

  function handleStockSubmit(event, grain) {
    event.preventDefault();
    const quantity = Number(stockAmount);
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    onAddStock(grain.name, quantity);
    setActiveContainer(null);
    setStockAmount("");
  }

  return (
    <div className="storage-grid">
      {grains.length === 0 && (
        <p className="storage-empty">Add a grain in Grain Inventory to create its container.</p>
      )}
      {grains.map((grain, index) => {
        const name = `Container ${String(index + 1).padStart(2, "0")}`;
        const color = storageColors[index % storageColors.length];

        return (
          <article className="storage-card" key={name}>
            <div className="storage-card-header">
              <div className="storage-symbol"><Icon name="storage" size={19} /></div>
              <div className="storage-card-title">
                <span>STORAGE CONTAINER</span>
                <h3>{name}</h3>
              </div>
            </div>

            <div className="storage-grain">
              <img src={getGrainImage(grain.name, grain.photo)} alt="" />
              <div>
                <span>Stored grain</span>
                <strong>{grain.name}</strong>
                {grain.photo && (
                  <a
                    className="photo-credit"
                    href={grain.photo.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Photo: {grain.photo.artist} · {grain.photo.license}
                  </a>
                )}
              </div>
            </div>

            <div className="storage-capacity">
              <div className="storage-capacity-heading">
                <span>Capacity used</span>
                <div className="storage-capacity-values">
                  <strong>{grain.capacity}</strong>
                  <span>{grain.quantity}</span>
                </div>
              </div>
              <div className="progress-track storage-progress">
                <div className={color} style={{ width: grain.capacity }} />
              </div>
              <p>{grain.capacity} occupied · {grain.quantity} stored</p>
              {grain.lastStockAddition && (
                <small className="storage-stock-history">
                  Previous {grain.lastStockAddition.previousQuantity} · Added {grain.lastStockAddition.addedQuantity}
                </small>
              )}
            </div>

            {activeContainer === grain.name ? (
              <form className="storage-add-stock" onSubmit={(event) => handleStockSubmit(event, grain)}>
                <label htmlFor={`stock-amount-${index}`}>Add quantity (kg)</label>
                <div>
                  <input
                    id={`stock-amount-${index}`}
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    autoFocus
                    value={stockAmount}
                    onChange={(event) => setStockAmount(event.target.value)}
                    placeholder="Enter kg"
                  />
                  <button className="storage-stock-submit" type="submit">Add</button>
                  <button
                    className="storage-stock-cancel"
                    type="button"
                    onClick={() => {
                      setActiveContainer(null);
                      setStockAmount("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="storage-add-stock-button"
                type="button"
                onClick={() => {
                  setActiveContainer(grain.name);
                  setStockAmount("");
                }}
              >
                + Add stock
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function EnvironmentReadings({ grains, selectedGrain, grainTargets, onGrainChange, onAddGrain }) {
  const targets = grainTargets?.[selectedGrain] || getDefaultGrainTargets(selectedGrain);
  const grainOptions = Array.from(new Map(
    [...commonMonitoringGrains, ...grains.map((grain) => grain.name)]
      .map((name) => [name.trim().toLowerCase(), name.trim()])
      .filter(([key]) => key),
  ).values());

  return (
    <div className="monitoring-content">
      <div className="monitoring-control-bar">
        <div className="monitoring-grain-field">
          <label htmlFor="monitoring-grain">Grain</label>
          <select
            id="monitoring-grain"
            value={selectedGrain}
            onChange={(event) => onGrainChange(event.target.value)}
          >
            {grainOptions.map((grainName) => <option key={grainName} value={grainName}>{grainName}</option>)}
          </select>
        </div>
        <button className="monitoring-add-grain-button" type="button" onClick={onAddGrain}>
          <span aria-hidden="true">+</span>
          Add to inventory
        </button>
      </div>

      <div className="monitoring-target-grid">
        <div className="monitoring-target-card temp">
          <div className="monitoring-illustration temperature-illustration" aria-hidden="true">
            <svg viewBox="0 0 100 100" focusable="false">
              <circle cx="50" cy="50" r="48" fill="#edf4f7" />
              <circle cx="69" cy="31" r="12" fill="#f3c66f" />
              <path d="M40 23a10 10 0 0 1 20 0v31a18 18 0 1 1-20 0V23Z" fill="#fff" stroke="#4d8495" strokeWidth="4" />
              <path d="M50 37v32" stroke="#d8795d" strokeWidth="6" strokeLinecap="round" />
              <circle cx="50" cy="69" r="8" fill="#d8795d" />
              <path d="M60 34h6M60 44h5" stroke="#4d8495" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <span>Minimum temperature</span>
            <strong>{targets ? `${targets.minTemperature} °C` : "Not set"}</strong>
          </div>
        </div>
        <div className="monitoring-target-card humidity">
          <div className="monitoring-illustration humidity-illustration" aria-hidden="true">
            <svg viewBox="0 0 100 100" focusable="false">
              <circle cx="50" cy="50" r="48" fill="#eaf4f2" />
              <path d="M50 17C42 31 28 46 28 62a22 22 0 0 0 44 0C72 46 58 31 50 17Z" fill="#69a9aa" />
              <path d="M39 62a11 11 0 0 0 11 11" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
              <circle cx="75" cy="28" r="4" fill="#9cc8c5" />
              <circle cx="25" cy="34" r="3" fill="#9cc8c5" />
            </svg>
          </div>
          <div>
            <span>Minimum humidity</span>
            <strong>{targets ? `${targets.minHumidity}%` : "Not set"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ csrfToken, onAuthenticated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "Unable to sign in.");
        return;
      }
      onAuthenticated(result);
    } catch {
      setError("Unable to reach the sign-in service. Check that the server is running and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand">
          <div className="brand-icon"><Icon name="brand" size={27} /></div>
          <div>
            <h1>GrainGuard</h1>
            <span>STORAGE MANAGEMENT</span>
          </div>
        </div>
        <div className="auth-heading">
          <span className="auth-eyebrow">ADMIN ACCESS</span>
          <h2 id="login-title">Welcome back</h2>
          <p>Sign in to manage your grain storage workspace.</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              autoComplete="username"
              autoFocus
              maxLength={64}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              maxLength={128}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="auth-footnote">Authorized administrators only</p>
      </section>
    </main>
  );
}

function App() {
  const [auth, setAuth] = useState({ status: "checking" });
  const [authRetry, setAuthRetry] = useState(0);
  const [authActionError, setAuthActionError] = useState("");
  const [active, setActive] = useState("Dashboard");
  const [grains, setGrains] = useState(() => {
    const savedGrains = window.localStorage.getItem("grainguard-grains");
    return savedGrains ? JSON.parse(savedGrains) : initialGrains;
  });
  const [grainTargets, setGrainTargets] = useState(() => {
    const savedTargets = window.localStorage.getItem("grainguard-grain-targets");
    const storedGrains = window.localStorage.getItem("grainguard-grains");
    const currentGrains = storedGrains ? JSON.parse(storedGrains) : initialGrains;
    const targets = savedTargets ? JSON.parse(savedTargets) : {};
    const targetGrainNames = [
      ...commonMonitoringGrains,
      ...currentGrains.map((grain) => grain.name),
    ];

    return targetGrainNames.reduce((allTargets, grainName) => ({
      ...allTargets,
      [grainName]: allTargets[grainName] || getDefaultGrainTargets(grainName),
    }), targets);
  });
  const [selectedMonitoringGrain, setSelectedMonitoringGrain] = useState(() => (
    window.localStorage.getItem("grainguard-monitoring-grain") || initialGrains[0].name
  ));
  const [isAddGrainOpen, setIsAddGrainOpen] = useState(false);
  const [returnToMonitoringAfterAdd, setReturnToMonitoringAfterAdd] = useState(false);

  useEffect(() => {
    if (active === "Settings") setActive("Dashboard");
  }, [active]);

  useEffect(() => {
    let isCurrent = true;

    async function checkAuthentication() {
      try {
        const csrfResponse = await fetch("/api/auth/csrf");
        if (!csrfResponse.ok) throw new Error("Unable to start a secure sign-in session.");
        const { csrfToken } = await csrfResponse.json();
        if (!csrfToken) throw new Error("The sign-in service returned an invalid session.");

        const response = await fetch("/api/auth/me");
        if (response.status === 401) {
          if (isCurrent) setAuth({ status: "unauthenticated", csrfToken });
          return;
        }
        if (!response.ok) throw new Error("Unable to verify your sign-in session.");

        const { username } = await response.json();
        if (isCurrent) setAuth({ status: "authenticated", csrfToken, username });
      } catch (error) {
        if (isCurrent) {
          setAuth({
            status: "error",
            message: error.message || "Unable to connect to the sign-in service.",
          });
        }
      }
    }

    checkAuthentication();
    return () => {
      isCurrent = false;
    };
  }, [authRetry]);

  useEffect(() => {
    window.localStorage.setItem("grainguard-grains", JSON.stringify(grains));
  }, [grains]);

  useEffect(() => {
    window.localStorage.setItem("grainguard-grain-targets", JSON.stringify(grainTargets));
  }, [grainTargets]);

  useEffect(() => {
    window.localStorage.setItem("grainguard-monitoring-grain", selectedMonitoringGrain);
  }, [selectedMonitoringGrain]);

  async function handleLogout() {
    setAuthActionError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": auth.csrfToken },
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Unable to sign out.");
      }
      setAuth({ status: "unauthenticated", csrfToken: auth.csrfToken });
    } catch (error) {
      setAuthActionError(error.message || "Unable to sign out. Please try again.");
    }
  }

  if (auth.status === "checking") {
    return <main className="auth-shell"><p className="auth-status">Verifying administrator session...</p></main>;
  }

  if (auth.status === "error") {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-status-card" role="alert">
          <div className="auth-brand">
            <div className="brand-icon"><Icon name="brand" size={27} /></div>
            <div><h1>GrainGuard</h1><span>STORAGE MANAGEMENT</span></div>
          </div>
          <h2>Sign-in service unavailable</h2>
          <p>{auth.message}</p>
          <button className="auth-submit" onClick={() => setAuthRetry((attempt) => attempt + 1)}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <LoginScreen
        csrfToken={auth.csrfToken}
        onAuthenticated={(result) => setAuth({
          status: "authenticated",
          csrfToken: result.csrfToken,
          username: result.username,
        })}
      />
    );
  }

  const totalGrainStock = grains.reduce(
    (total, grain) => total + getQuantityInKg(grain.quantity),
    0,
  );
  const averageCapacity = grains.length
    ? Math.round(grains.reduce((total, grain) => total + (Number.parseFloat(grain.capacity) || 0), 0) / grains.length)
    : 0;
  const grainsNeedingReview = grains.filter((grain) => grain.status !== "Healthy").length;
  const monitoringGrainOptions = [
    ...commonMonitoringGrains,
    ...grains.map((grain) => grain.name),
  ];
  const monitoringGrain = monitoringGrainOptions.find(
    (grainName) => grainName.trim().toLowerCase() === selectedMonitoringGrain.trim().toLowerCase(),
  ) || commonMonitoringGrains[0];

  const menu = [
    ["dashboard", "Dashboard"],
    ["inventory", "Grain Inventory"],
    ["storage", "Storage Units"],
    ["monitoring", "Monitoring"],
    ["reports", "Reports"],
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><Icon name="brand" size={27} /></div>
          <div>
            <h2>GrainGuard</h2>
            <span>STORAGE MANAGEMENT</span>
          </div>
        </div>

        <nav aria-label="Main navigation">
          {menu.map(([icon, name]) => (
            <button
              key={name}
              className={`nav-item ${active === name ? "selected" : ""}`}
              aria-label={name}
              aria-current={active === name ? "page" : undefined}
              title={name}
              onClick={() => setActive(name)}
            >
              <span className="nav-icon"><Icon name={icon} /></span>
              {name}
            </button>
          ))}
        </nav>

      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h2>{active}</h2>
          </div>
          <div className="top-actions">
            <button
              className="notification"
              aria-label="Open monitoring alerts"
              title="Open monitoring alerts"
              onClick={() => setActive("Monitoring")}
            >
              <Icon name="bell" />
              <span className="notification-dot" />
            </button>
            <div className="profile">
              <div className="avatar">{auth.username.charAt(0).toUpperCase()}</div>
              <div>
                <strong>{auth.username}</strong>
              </div>
            </div>
            <button className="logout-btn" aria-label="Sign out" title="Sign out" onClick={handleLogout}>
              <Icon name="logout" size={17} />
            </button>
          </div>
        </header>

        {authActionError && <p className="auth-inline-error" role="alert">{authActionError}</p>}

        {active === "Dashboard" ? (
          <div className="dashboard-overview">
            <section className="welcome">
              <div>
                <h1>Your grain storage, at a glance</h1>
              </div>
            </section>

            <section className="stats">
              <div className="stat-card">
                <div className="stat-top">
                  <span>Total Grain Stock</span>
                  <div className="stat-icon blue"><Icon name="inventory" /></div>
                </div>
                <h2>{totalGrainStock.toLocaleString("en-US")} <small>kg</small></h2>
                <p className="muted">Across all storage units</p>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Average Capacity</span>
                  <div className="stat-icon purple"><Icon name="storage" /></div>
                </div>
                <h2>{averageCapacity}<small>%</small></h2>
                <p className="positive">Across tracked grains</p>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Grain Types</span>
                  <div className="stat-icon green"><Icon name="dashboard" /></div>
                </div>
                <h2>{grains.length}</h2>
                <p className="muted">Tracked in inventory</p>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Needs Review</span>
                  <div className="stat-icon orange"><Icon name="alert" /></div>
                </div>
                <h2>{grainsNeedingReview}</h2>
                <p className="warning-text">Inventory items to review</p>
              </div>
            </section>
          </div>
        ) : (
          <>
            {active === "Grain Inventory" && (
              <section className="panel section-panel">
                <div className="panel-heading">
                  <h3>Grain Inventory</h3>
                  {!isAddGrainOpen && (
                    <button className="primary-btn add-grain-button" onClick={() => setIsAddGrainOpen(true)}>
                      + Add grain
                    </button>
                  )}
                </div>
                {isAddGrainOpen && (
                  <AddGrainForm
                    grains={grains}
                    onCancel={() => {
                      setIsAddGrainOpen(false);
                      if (returnToMonitoringAfterAdd) {
                        setActive("Monitoring");
                        setReturnToMonitoringAfterAdd(false);
                      }
                    }}
                    onAdd={(addedGrain) => {
                      const matchingGrain = grains.find(
                        (grain) => grain.name.trim().toLowerCase() === addedGrain.name.trim().toLowerCase(),
                      );
                      const selectedGrainName = matchingGrain?.name || addedGrain.name;
                      setGrainTargets((currentTargets) => (
                        currentTargets[selectedGrainName]
                          ? currentTargets
                          : {
                            ...currentTargets,
                            [selectedGrainName]: getDefaultGrainTargets(selectedGrainName),
                          }
                      ));
                      setGrains((currentGrains) => {
                        const existingGrain = currentGrains.find(
                          (grain) => grain.name.trim().toLowerCase() === addedGrain.name.trim().toLowerCase(),
                        );
                        if (!existingGrain) return [...currentGrains, addedGrain];

                        const previousQuantityKg = getQuantityInKg(existingGrain.quantity);
                        const addedQuantityKg = getQuantityInKg(addedGrain.quantity);
                        return currentGrains.map((grain) => (
                          grain === existingGrain
                            ? {
                              ...grain,
                              quantity: `${(previousQuantityKg + addedQuantityKg).toLocaleString("en-US")} kg`,
                              capacity: addedGrain.capacity || grain.capacity,
                              lastStockAddition: {
                                previousQuantity: existingGrain.quantity,
                                addedQuantity: `${addedQuantityKg.toLocaleString("en-US")} kg`,
                              },
                              photo: grain.photo || addedGrain.photo,
                            }
                            : grain
                        ));
                      });
                      setSelectedMonitoringGrain(selectedGrainName);
                      setIsAddGrainOpen(false);
                      if (returnToMonitoringAfterAdd) {
                        setActive("Monitoring");
                        setReturnToMonitoringAfterAdd(false);
                      }
                    }}
                  />
                )}
                <GrainTable grains={grains} />
              </section>
            )}

            {active === "Storage Units" && (
              <section className="panel section-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Storage Units</h3>
                  </div>
                </div>
                <StorageUnitList
                  grains={grains}
                  onAddStock={(grainName, quantityToAdd) => {
                    setGrains((currentGrains) => currentGrains.map((grain) => {
                      if (grain.name !== grainName) return grain;

                      const previousQuantityKg = getQuantityInKg(grain.quantity);
                      return {
                        ...grain,
                        quantity: `${(previousQuantityKg + quantityToAdd).toLocaleString("en-US")} kg`,
                        lastStockAddition: {
                          previousQuantity: grain.quantity,
                          addedQuantity: `${quantityToAdd.toLocaleString("en-US")} kg`,
                        },
                      };
                    }));
                  }}
                />
              </section>
            )}

            {active === "Monitoring" && (
              <section className="panel section-panel monitoring-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Environment Monitoring</h3>
                  </div>
                </div>
                <EnvironmentReadings
                  grains={grains}
                  selectedGrain={monitoringGrain}
                  grainTargets={grainTargets}
                  onGrainChange={setSelectedMonitoringGrain}
                  onAddGrain={() => {
                    setReturnToMonitoringAfterAdd(true);
                    setIsAddGrainOpen(true);
                    setActive("Grain Inventory");
                  }}
                />
              </section>
            )}

            {active === "Reports" && (
              <section className="panel section-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Storage Summary</h3>
                    <p>Current grain stock and storage status</p>
                  </div>
                </div>
                <div className="report-summary">
                  <div><span>Total Grain Stock</span><strong>{totalGrainStock.toLocaleString("en-US")} kg</strong></div>
                  <div><span>Average Capacity</span><strong>{averageCapacity}%</strong></div>
                  <div><span>Active Containers</span><strong>{grains.length}</strong></div>
                  <div><span>Grains Needing Attention</span><strong>{grainsNeedingReview}</strong></div>
                </div>
                <GrainStockChart grains={grains} />
              </section>
            )}

          </>
        )}

      </main>
    </div>
  );
}

export default App;
