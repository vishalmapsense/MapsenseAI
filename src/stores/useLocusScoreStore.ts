import { create } from "zustand";
import { FlyToInterpolator } from "@deck.gl/core";
import { useMapStore } from "@/stores/useMapStore";
import type {
  AmenityCategoryId,
  PinCodeData,
  PinComparisonResult,
  SectorProfileId,
} from "@/types/locusScore.types";
import {
  ALL_CATEGORY_IDS,
  BENCHMARK_PIN_CODES,
  comparePinCodes,
  fetchOrResolvePinCode,
  generateCategoryPOIGeoJson,
  generatePinBufferGeoJson,
  recalculatePinWithD0,
} from "@/services/locusScoreService";
import { toast } from "sonner";

interface LocusScoreState {
  isModalOpen: boolean;
  pinCodeA: string;
  pinCodeB: string;
  dataPinA: PinCodeData;
  dataPinB: PinCodeData;
  activeSector: SectorProfileId;
  d0: number; // default 0.5 km
  activeTab: "comparison" | "algorithm" | "pois";
  activeLayers: Record<string, boolean>; // key: `${pinCode}_${category}`
  bufferLayers: Record<string, boolean>; // key: pinCode -> true/false
  isLoading: boolean;
  comparisonResult: PinComparisonResult;

  // Actions
  setModalOpen: (open: boolean) => void;
  setActiveSector: (sector: SectorProfileId) => void;
  setD0: (d0: number) => void;
  setActiveTab: (tab: "comparison" | "algorithm" | "pois") => void;
  setPinA: (pin: string) => Promise<void>;
  setPinB: (pin: string) => Promise<void>;
  loadPreset: (pinA: string, pinB: string) => Promise<void>;
  toggleCategoryLayerOnMap: (pinCode: string, categoryId: AmenityCategoryId) => void;
  toggleAllLayersOnMap: (pinCode: string, enable: boolean) => void;
  toggleBufferOnMap: (pinCode: string) => void;
  flyToPin: (pinCode: string) => void;
  clearAllLocusLayersFromMap: () => void;
}

const defaultPinA = BENCHMARK_PIN_CODES["560001"];
const defaultPinB = BENCHMARK_PIN_CODES["560103"];
const defaultResult = comparePinCodes(defaultPinA, defaultPinB, "real_estate", 0.5);

export const useLocusScoreStore = create<LocusScoreState>((set, get) => ({
  isModalOpen: false,
  pinCodeA: "560001",
  pinCodeB: "560103",
  dataPinA: defaultPinA,
  dataPinB: defaultPinB,
  activeSector: "real_estate",
  d0: 0.5,
  activeTab: "comparison",
  activeLayers: {},
  bufferLayers: {},
  isLoading: false,
  comparisonResult: defaultResult,

  setModalOpen: (open: boolean) => set({ isModalOpen: open }),

  setActiveSector: (sector: SectorProfileId) => {
    const { dataPinA, dataPinB, d0 } = get();
    const updated = comparePinCodes(dataPinA, dataPinB, sector, d0);
    set({ activeSector: sector, comparisonResult: updated });
  },

  setD0: (d0: number) => {
    const { dataPinA, dataPinB, activeSector } = get();
    const tunedA = recalculatePinWithD0(dataPinA, d0);
    const tunedB = recalculatePinWithD0(dataPinB, d0);
    const updated = comparePinCodes(tunedA, tunedB, activeSector, d0);
    set({ d0, dataPinA: tunedA, dataPinB: tunedB, comparisonResult: updated });
  },

  setActiveTab: (tab: "comparison" | "algorithm" | "pois") => set({ activeTab: tab }),

  setPinA: async (pin: string) => {
    set({ isLoading: true });
    try {
      const data = await fetchOrResolvePinCode(pin, get().d0);
      const comparison = comparePinCodes(data, get().dataPinB, get().activeSector, get().d0);
      set({ pinCodeA: data.pinCode, dataPinA: data, comparisonResult: comparison, isLoading: false });
    } catch (e: any) {
      toast.error(`Could not resolve PIN code ${pin}: ${e?.message || e}`);
      set({ isLoading: false });
    }
  },

  setPinB: async (pin: string) => {
    set({ isLoading: true });
    try {
      const data = await fetchOrResolvePinCode(pin, get().d0);
      const comparison = comparePinCodes(get().dataPinA, data, get().activeSector, get().d0);
      set({ pinCodeB: data.pinCode, dataPinB: data, comparisonResult: comparison, isLoading: false });
    } catch (e: any) {
      toast.error(`Could not resolve PIN code ${pin}: ${e?.message || e}`);
      set({ isLoading: false });
    }
  },

  loadPreset: async (pinA: string, pinB: string) => {
    set({ isLoading: true });
    try {
      const dataA = await fetchOrResolvePinCode(pinA, get().d0);
      const dataB = await fetchOrResolvePinCode(pinB, get().d0);
      const comparison = comparePinCodes(dataA, dataB, get().activeSector, get().d0);
      set({
        pinCodeA: dataA.pinCode,
        pinCodeB: dataB.pinCode,
        dataPinA: dataA,
        dataPinB: dataB,
        comparisonResult: comparison,
        isLoading: false,
      });
      toast.success(`Loaded PIN comparison: ${dataA.pinCode} vs ${dataB.pinCode}`);
    } catch (e: any) {
      toast.error(`Failed to load preset: ${e?.message || e}`);
      set({ isLoading: false });
    }
  },

  toggleCategoryLayerOnMap: (pinCode: string, categoryId: AmenityCategoryId) => {
    const { dataPinA, dataPinB, activeLayers } = get();
    const pin = pinCode === dataPinA.pinCode ? dataPinA : dataPinB;
    const layerKey = `${pinCode}_${categoryId}`;
    const nextState = !activeLayers[layerKey];

    const currentMapFeatures = [...useMapStore.getState().mapFeatures];
    const layerIdentifier = `locus_${layerKey}`;

    if (nextState) {
      // Add layer to map
      const geojson = generateCategoryPOIGeoJson(pin, categoryId);
      // Attach an internal identifier
      (geojson as any)._locusId = layerIdentifier;

      // Filter any existing version of this locus layer
      const cleaned = currentMapFeatures.filter((f: any) => f?._locusId !== layerIdentifier);
      useMapStore.getState().setMapFeatures([...cleaned, geojson]);

      // Fly camera towards POI cluster / PIN
      useMapStore.getState().setViewState({
        longitude: pin.lng,
        latitude: pin.lat,
        zoom: Math.max(useMapStore.getState().viewState.zoom, 14),
        transitionDuration: 1000,
        transitionInterpolator: new FlyToInterpolator(),
      });

      toast.success(`Rendered ${geojson.features.length} ${categoryId} POIs for ${pin.pinCode} on map`);
    } else {
      // Remove layer from map
      const filtered = currentMapFeatures.filter((f: any) => f?._locusId !== layerIdentifier);
      useMapStore.getState().setMapFeatures(filtered);
    }

    set({
      activeLayers: {
        ...activeLayers,
        [layerKey]: nextState,
      },
    });
  },

  toggleAllLayersOnMap: (pinCode: string, enable: boolean) => {
    const { dataPinA, dataPinB, activeLayers } = get();
    const pin = pinCode === dataPinA.pinCode ? dataPinA : dataPinB;
    const currentMapFeatures = [...useMapStore.getState().mapFeatures];

    let updatedFeatures = [...currentMapFeatures];
    const nextLayersState = { ...activeLayers };

    ALL_CATEGORY_IDS.forEach((catId) => {
      const layerKey = `${pinCode}_${catId}`;
      const layerIdentifier = `locus_${layerKey}`;

      // Remove existing
      updatedFeatures = updatedFeatures.filter((f: any) => f?._locusId !== layerIdentifier);

      if (enable) {
        const geojson = generateCategoryPOIGeoJson(pin, catId);
        (geojson as any)._locusId = layerIdentifier;
        updatedFeatures.push(geojson);
        nextLayersState[layerKey] = true;
      } else {
        nextLayersState[layerKey] = false;
      }
    });

    useMapStore.getState().setMapFeatures(updatedFeatures);

    if (enable) {
      useMapStore.getState().setViewState({
        longitude: pin.lng,
        latitude: pin.lat,
        zoom: 14,
        transitionDuration: 1200,
        transitionInterpolator: new FlyToInterpolator(),
      });
      toast.success(`Displayed all 8 amenity layers for ${pin.pinCode} (${pin.name})`);
    }

    set({ activeLayers: nextLayersState });
  },

  toggleBufferOnMap: (pinCode: string) => {
    const { dataPinA, dataPinB, bufferLayers } = get();
    const pin = pinCode === dataPinA.pinCode ? dataPinA : dataPinB;
    const isCurrentlyOn = !!bufferLayers[pinCode];
    const nextState = !isCurrentlyOn;
    const bufferId = `locus_buffer_${pinCode}`;

    const currentMapFeatures = [...useMapStore.getState().mapFeatures];
    const cleaned = currentMapFeatures.filter((f: any) => f?._locusId !== bufferId);

    if (nextState) {
      const bufferGeoJson = generatePinBufferGeoJson(pin, 1.0);
      (bufferGeoJson as any)._locusId = bufferId;
      useMapStore.getState().setMapFeatures([...cleaned, bufferGeoJson]);
      toast.success(`Rendered 1 km buffer catchment zone for ${pin.pinCode}`);
    } else {
      useMapStore.getState().setMapFeatures(cleaned);
    }

    set({
      bufferLayers: {
        ...bufferLayers,
        [pinCode]: nextState,
      },
    });
  },

  flyToPin: (pinCode: string) => {
    const { dataPinA, dataPinB } = get();
    const pin = pinCode === dataPinA.pinCode ? dataPinA : dataPinB;
    useMapStore.getState().setViewState({
      longitude: pin.lng,
      latitude: pin.lat,
      zoom: 14.5,
      pitch: 35,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator(),
    });
  },

  clearAllLocusLayersFromMap: () => {
    const current = useMapStore.getState().mapFeatures;
    const nonLocus = current.filter((f: any) => !f?._locusId?.startsWith("locus_"));
    useMapStore.getState().setMapFeatures(nonLocus);
    set({ activeLayers: {}, bufferLayers: {} });
    toast.info("Cleared all LocusScore layers from map");
  },
}));
