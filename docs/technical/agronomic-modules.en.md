# AgroGea — Technical documentation of the agronomic modules

> [🇮🇹 Italiano](./moduli-agronomici.md) · 🇬🇧 English

> This document explains **how the agronomic modules of AgroGea actually work**: which quantities they compute, with which formulas and assumptions, and how to interpret the results. It is the technical companion to the [User Manual](../user-guide/manual.en.md), which instead describes *where to click*.
>
> All calculation engines are **pure functions** in `plugins/agro-tools/src/` (NDVI, FAO 56/66, phenology, phytopathology, soil, zoning): they run entirely on the device, with no network. The agronomic parameters (temperature thresholds, crop coefficients, response factors) are **editable literature defaults, not regulatory constants**: they must be tuned to the actual environment and crop.

---

## Table of contents

1. [Satellite vegetation indices](#1-satellite-vegetation-indices)
2. [Phenological calibration per crop](#2-phenological-calibration-per-crop)
3. [From texture to soil water parameters (pedotransfer)](#3-from-texture-to-soil-water-parameters-pedotransfer)
4. [Water balance (FAO 56/66)](#4-water-balance-fao-5666)
5. [Yield reduction from water stress](#5-yield-reduction-from-water-stress)
6. [Phytopathological DSS and degree-days](#6-phytopathological-dss-and-degree-days)
7. [DSS risk map (green/yellow/red)](#7-dss-risk-map-greenyellowred)
8. [Variable-rate application maps (VRA)](#8-variable-rate-application-maps-vra)
9. [Field Calculator formulas](#9-field-calculator-formulas)
10. [References](#10-references)

---

## 1. Satellite vegetation indices

**What they are for.** A vegetation index turns the reflectances of a few spectral bands into a number that estimates the **state of the vegetation** (photosynthetically active biomass, vigor, chlorophyll or water content). AgroGea computes them from **Sentinel-2** imagery (10–20 m resolution, accessed via STAC) and uses them for: vigor mapping, VRA zoning basis, a component of the DSS score, correlation with soil chemistry.

**Data source.** The functions operate on `Float32Array` reflectances already reprojected onto the same grid; no-data pixels produce `NaN` so that symbology and zonal statistics can exclude them.

### Normalized-difference indices — (a − b) / (a + b)

These are the most robust indices because the normalized ratio reduces the effect of illumination and topography.

| Index | Formula (Sentinel-2 bands) | What it measures |
|---|---|---|
| **NDVI** | (B08 − B04) / (B08 + B04) = (NIR − Red) / (NIR + Red) | Green vigor/biomass. The reference index; it saturates at high canopy cover. |
| **NDRE** | (B08 − B05) / (B08 + B05) = (NIR − Red-Edge) / (NIR + Red-Edge) | Nitrogen/chlorophyll status. The red-edge penetrates the dense canopy better: more sensitive than NDVI on fully-vegetated vineyard and orchard. |
| **NDWI** | (B03 − B08) / (B03 + B08) = (Green − NIR) / (Green + NIR) | Water content of the vegetation and saturated surfaces (McFeeters formulation). High values = more water. |

> **A note on interpretation:** the absolute value is not comparable across different crops or phenological stages. The same NDVI = 0.55 is "poor" for an arable crop at full cover and "normal" for a vineyard at the start of the season. That is why AgroGea does not read indices in absolute terms but **parameterizes them on the phenological stage** (see §2).

### Soil-adjusted indices — SAVI and MSAVI2

When vegetation cover is sparse (young tree crops, early stages, wide-row crops), the bare soil between plants "contaminates" the signal. Soil-adjusted indices compensate for it.

- **SAVI** — Soil-Adjusted Vegetation Index (Huete 1988):

  ```
  SAVI = ((NIR − Red) / (NIR + Red + L)) · (1 + L)
  ```

  The `L` factor (0..1, default **0.5**) dampens the soil influence: high for sparse cover, low at full cover. With `L = 0` it degenerates exactly into NDVI.

- **MSAVI2** — Modified SAVI (Qi et al. 1994):

  ```
  MSAVI2 = (2·NIR + 1 − √((2·NIR + 1)² − 8·(NIR − Red))) / 2
  ```

  The correction factor **self-calibrates pixel by pixel**, removing the manual choice of `L`. It is the most reliable index on bare soil or low cover.

### Soil-masking (canopy isolation)

On **tree crops** the inter-row (soil, cover crop) must be excluded before computing the statistics, otherwise it artificially lowers the average. AgroGea zeroes out (→ `NaN`) the pixels below an **index threshold** that comes from the crop's phenological matrix (e.g., bare-soil NDVI ~0.2, canopy far higher). The **fraction of valid pixels** after masking is itself an estimate of vegetation cover. On continuous-cover arable crops masking is not applied.

### Statistics and symbology

For each parcel, mean, min, max, standard deviation and number of valid pixels are computed (on non-`NaN` pixels only). The raster overlay uses dedicated color ramps: a vigor ramp (red → green) for NDVI/NDRE/SAVI/MSAVI2 and a water ramp (beige → blue) for NDWI.

---

## 2. Phenological calibration per crop

**What it is for.** It is the "dictionary" that makes indices and models comparable across crops and seasons. For each crop and **phenological stage** (initial, development, mid-season, maturity) the matrix defines:

- the **crop coefficient Kc** (for the water balance, §4);
- the **NDVI soil-masking threshold** (for canopy isolation, §1);
- the **expected NDVI band** [min, max] for the stage, the basis of the relative vigor scale;
- the **temperature thresholds** `tBase` and `tCutoff` (for degree-days, §6).

Calibrated crops: **vine, olive, apple** (tree crops, with soil-masking active) and **wheat, maize, tomato** (continuous cover). Example — vine has `tBase = 10 °C`, `tCutoff = 30 °C`, and Kc rising from 0.3 (budburst) to 0.85 (full vegetation) then falling back to 0.45 at maturity. The values are consistent with FAO-56 and the agronomic literature, and are **editable**.

---

## 3. From texture to soil water parameters (pedotransfer)

**What it is for.** The water balance needs two soil hydraulic constants — **field capacity θFC** and **wilting point θPWP** — which are rarely measured on-farm. AgroGea estimates them from the **texture** (what usually *is* available: a textural class or the sand/silt/clay percentages) via **pedotransfer functions**.

### Resolving the texture

From a textual class (multilingual IT/EN/ES, e.g., "franco argilloso" / "clay loam" / "franco arcilloso") the three particle-size fractions are resolved. Exact matching uses the **USDA centroids** of the 12 textural classes; if the label is compound or atypical, a keyword-based heuristic fallback still assigns plausible fractions. Alternatively the sand/silt/clay percentages are entered directly, normalized to sum 1.

### Saxton & Rawls equations (2006)

Given sand (S), clay (C) and organic matter (OM, % by weight), the volumetric water contents at the two reference tensions are estimated:

- **Wilting point** θ at 1500 kPa;
- **Field capacity** θ at 33 kPa.

The constants are the published ones (*Soil Sci. Soc. Am. J.* 70:1569–1578). The output is constrained to plausible physical limits: `0 < θPWP < θFC < porosity (~0.55)`. Defaults: organic matter 2.5% (typical agricultural soil), root depth 0.8 m, depletion fraction p = 0.5 — all overridable.

> **Why it matters.** A clayey soil holds far more available water than a sandy one: with the same climate and crop, the number of days of water autonomy changes radically. Providing the parcel's soil composition is the single piece of data that most improves the accuracy of the balance.

---

## 4. Water balance (FAO 56/66)

**What it is for.** To estimate day by day **how much water is in the root zone** and to predict when the crop will enter water stress, so irrigation can be planned with a model instead of by feel. It follows the root-zone water balance method of FAO Irrigation & Drainage Paper 56 (Allen et al. 1998) and 66.

### Step 1 — Reference evapotranspiration ET₀ (Penman-Monteith FAO-56)

ET₀ is the evapotranspiration of a reference crop (grass, 0.12 m height, albedo 0.23) under optimal water conditions. It is computed with the **Penman-Monteith FAO-56** equation from weather-station data:

```
        0.408·Δ·(Rn − G) + γ·(900/(T+273))·u₂·(es − ea)
ET₀ = ─────────────────────────────────────────────────
              Δ + γ·(1 + 0.34·u₂)
```

where Δ is the slope of the vapor-pressure curve (Tetens), γ the psychrometric constant derived from atmospheric pressure (a function of altitude), Rn the net radiation, G the soil heat flux (≈ 0 on a daily basis), u₂ the wind at 2 m, (es − ea) the vapor-pressure deficit from T and min/max relative humidity. The net long-wave radiation, if not provided, is estimated with the FAO-56 formulation (Stefan-Boltzmann, correction for humidity and cloudiness).

### Step 2 — Crop evapotranspiration ETc

```
ETc = ET₀ · Kc
```

The **crop coefficient Kc** depends on crop and phenological stage (matrix in §2). ETc is the actual daily water consumption of the crop.

### Step 3 — Root-zone balance (depletion equation)

The **root-zone depletion Dr** (mm of water missing relative to field capacity) is tracked with the FAO-56 eq. 85 in explicit form:

```
Dr,t = Dr,t-1 − P_t − I_t + ETc,t + DP_t        (then clamped to [0, AWC])
```

- **P** = effective rainfall of the day (mm), **I** = irrigation measured from the management logs (mm);
- **DP** = deep percolation: the water that drains below the root zone when the input exceeds field capacity. It is an **explicit term** of the balance (FAO-56 eq. 88): `DP = max(0, −(Dr,t-1 − P − I + ETc))`. There is no percolation until the profile is saturated;
- capillary rise (CR) and runoff (RO) are neglected (≈ 0): a conservative default consistent with station data.

Two quantities define the soil-reservoir capacity (from the parameters in §3):

- **AWC** (Total Available Water) = (θFC − θPWP) · root depth · 1000 [mm];
- **RAW** (Readily Available Water) = p · AWC, with p the no-stress depletion fraction (FAO-56 ~0.5).

**Stress threshold:** while Dr ≤ RAW the crop transpires without limitation; when **Dr ≥ RAW** it enters water stress. The **days of autonomy** are the days before Dr, without irrigating, reaches RAW.

### Predictive irrigation plan

A variant projects the balance forward with automatic irrigation: when depletion reaches RAW, it prescribes an intervention that brings the soil back to field capacity (Dr = 0), thus suggesting the **volume and timing** of irrigation.

---

## 5. Yield reduction from water stress

**What it is for.** To quantify the productive cost of water stress, not just to flag it. It relies on two FAO quantities.

### Water stress coefficient Ks (FAO-56 eq. 84)

```
Ks = 1                              if Dr ≤ RAW  (no stress)
Ks = (AWC − Dr) / (AWC − RAW)       if Dr > RAW  (decreases linearly)
Ks = 0                              at wilting point (Dr = AWC)
```

Ks is the factor by which actual transpiration is reduced relative to potential: below RAW the crop "closes its stomata" and transpires less.

### Yield reduction (FAO-33/66)

```
1 − Ya/Ym = Ky · (1 − ETa/ETc) = Ky · (1 − Ks)
```

where **Ky** is the crop's **water-stress response factor** (editable default per crop). The output is the **fraction of yield lost** in [0, 1]. Ky > 1 indicates crops very sensitive to stress (e.g., maize at flowering); Ky < 1 more tolerant crops.

> This is a first-approximation agronomic estimate, useful to compare scenarios and prioritize interventions, not a precise yield forecast.

---

## 6. Phytopathological DSS and degree-days

**What it is for.** To anticipate disease risks and the phenology of crops and insects from the weather series, for **integrated and targeted** protection (treat when needed, not by calendar). Output: typed alerts with a risk level (none/low/medium/high) and a 1–5 index for the DSS gauge.

### Degree-days (Growing Degree Days)

Thermal accumulation governs the development of plants and insects. AgroGea offers two methods:

- **Average-threshold:** `GDD = clamp((Tmax+Tmin)/2, [tBase, tCutoff]) − tBase`. The upper cutoff prevents extreme temperatures from inflating the accumulation.
- **Single-sine (Baskerville-Emin):** integrates the day's sinusoidal thermal curve; more accurate than average-threshold near the base threshold, typically used for insects.

The cumulative accumulation flags the day a target threshold is exceeded (e.g., the appearance of a target stage). `tBase`/`tCutoff` come from the crop matrix (§2).

### Grapevine downy mildew — "three-ten" rule

The classic model (Baldacci/Goidanich) for the **primary infection** of *Plasmopara viticola*. Risk triggers when, in the same window, the three conditions coexist:

- shoots ≥ **10 cm**,
- mean temperature ≥ **10 °C**,
- rainfall ≥ **10 mm**.

When all three occur, the module generates a high-risk alert (index 5) suggesting evaluation of a preventive treatment.

### Grapevine powdery mildew — thermal window

*Erysiphe necator* is favored by temperatures of **20–27 °C** with moderate humidity, disfavored by T > 32 °C or beating rain. The model evaluates the favorable window each day and **escalates the risk if favorable days are consecutive** (low → medium → high), returning the worst alert of the window.

### Olive peacock spot — leaf wetness/temperature

*Spilocaea oleagina* (*Fusicladium oleagineum*) requires **prolonged leaf wetness** (≥ ~10 h) with mild temperature (optimum ~15–20 °C, tolerated ~8–26 °C): the driver is spring/autumn humidity, not the dry summer. Long wetness (≥ 18 h) in the full optimal band produces a severe event even in a single day; otherwise the risk escalates over consecutive infection days. The alert suggests evaluation of a copper-based defense.

---

## 7. DSS risk map (green/yellow/red)

**What it is for.** To synthesize at **a glance** the agronomic state of each parcel, combining heterogeneous signals into a single score normalized 0..1:

- 🟢 **Green — optimal:** no relevant issues;
- 🟡 **Yellow — alert:** conditions to be monitored (entry into stress or growing fungal risk);
- 🔴 **Red — critical:** intervention recommended.

The score combines four components, each reported on a 0..1 scale:

- **water stress** — from Dr relative to RAW/AWC (§4);
- **phytopathological risk** — from the fungal-model alerts, with the 1–5 index normalized (index/5) (§6);
- **vigor** — from NDVI relative to the stage's expected band (§1–2);
- **soil fertility** — from nitrogen and organic matter.

The **weights are calibrated per crop**: tree crops weight vigor and diseases more, arable crops weight water stress more. As with the other engines, weights and thresholds are editable defaults.

---

## 8. Variable-rate application maps (VRA)

**What they are for.** A VRA (Variable-Rate Application) map divides the parcel into **homogeneous zones** and assigns each a **different dose** of input (fertilizer, seed, water, pesticide), to be sent to the tractor's ISOBUS terminal. The goal is to distribute the input where it is needed, reducing waste and non-uniformity.

### Zoning — deterministic 1-D K-Means

The pixels of a base index (e.g., mean historical NDVI) are grouped into **k vigor classes** (typically 3–5) with a one-dimensional K-Means:

- **quantile centroid initialization** (not random): same input → same output. This is a requirement for **reproducible and auditable** maps;
- being 1-D, cluster assignment is a simple threshold search between centroids;
- `NaN` pixels (soil-masking) are discarded.

For each class you get the centroid, interval [min, max), count and fraction of the total.

### Dose assignment

Starting from a **reference dose**, the map applies one of two agronomic logics:

- **Conservative** — more dose where vigor is **low** (fill the gaps, even out the crop). Typical for nitrogen/maintenance fertilization.
- **Aggressive** ("spinta") — more dose where vigor is **high** (support the yield potential). Typical for variable-rate sowing.

An `intensity` parameter (0..1) controls the maximum deviation from the reference dose between the lowest- and highest-vigor zone. The zones are then vectorized (DuckDB Spatial) and exported as **ISO-XML** or **GeoJSON** for the field terminals.

---

## 9. Field Calculator formulas

The Field Calculator derives **new** fields from the attribute table without altering the original data. The ready formulas:

| Derived field | Formula | Notes |
|---|---|---|
| **Plant density** | `plant_count / area_ha` | Plants per hectare. |
| **Yield (t/ha)** | `(yield_kg / 1000) / area_ha` | kg → t conversion over the area. |
| **Max organic N (NVZ)** | `area_ha × 170` | Organic-nitrogen ceiling (kg N/ha·year) allowed in a **Nitrate Vulnerable Zone**, per the Nitrates Directive 91/676/EEC. Outside NVZs the reference limit is higher (typically 340 kg N/ha): the value must be adapted to the farm's regulatory context. |

---

## 10. References

- **Allen R.G., Pereira L.S., Raes D., Smith M. (1998).** *Crop Evapotranspiration — Guidelines for computing crop water requirements.* FAO Irrigation and Drainage Paper 56. — ET₀ Penman-Monteith, Kc, root-zone balance, stress coefficient Ks.
- **Steduto P., Hsiao T.C., Fereres E., Raes D. (2012).** *Crop yield response to water.* FAO Irrigation and Drainage Paper 66; **Doorenbos J., Kassam A.H. (1979)**, Paper 33. — Response factor Ky and yield reduction.
- **Saxton K.E., Rawls W.J. (2006).** *Soil water characteristic estimates by texture and organic matter for hydrologic solutions.* Soil Sci. Soc. Am. J. 70:1569–1578. — θFC/θPWP pedotransfer.
- **Huete A.R. (1988).** *A Soil-Adjusted Vegetation Index (SAVI).* Remote Sensing of Environment 25:295–309.
- **Qi J., Chehbouni A., Huete A.R., Kerr Y.H., Sorooshian S. (1994).** *A Modified Soil Adjusted Vegetation Index (MSAVI).* Remote Sensing of Environment 48:119–126.
- **Rouse J.W. et al. (1974).** *Monitoring vegetation systems in the Great Plains with ERTS.* — NDVI.
- **McFeeters S.K. (1996).** *The use of the Normalized Difference Water Index (NDWI).* International Journal of Remote Sensing 17:1425–1432.
- **Baskerville G.L., Emin P. (1969).** *Rapid estimation of heat accumulation from maximum and minimum temperatures.* Ecology 50:514–517. — Single-sine degree-days.
- **Goidanich G. (1964).** *Manuale di Patologia Vegetale.* — "Three-ten" rule for grapevine downy mildew.
- **Council Directive 91/676/EEC (Nitrates Directive)** — organic-nitrogen ceiling in Nitrate Vulnerable Zones.
