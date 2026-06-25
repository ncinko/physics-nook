import { DAY_MS, MINUTE_MS } from './time.ts';

export const LIVE_EARTH_WINDOW_MS = 3 * DAY_MS;
export const LIVE_EARTH_TEXTURE_WIDTH = 2048;
export const LIVE_EARTH_TEXTURE_HEIGHT = 1024;
export const LIVE_EARTH_MASK_BLUR_RADIUS = 4;

export type LiveEarthProviderId =
  | 'nasa-viirs-snpp-true-color'
  | 'eumetview-multimission-natural'
  | 'eumetview-mtg-geocolour'
  | 'nasa-goes-west-geocolor'
  | 'nasa-goes-east-geocolor';

export interface LiveEarthProvider {
  id: LiveEarthProviderId;
  label: string;
  endpoint: string;
  wmsVersion: '1.1.1' | '1.3.0';
  layer: string;
  cadenceMinutes: number;
  delayMinutes: number;
  priority: number;
  timeMode: 'day' | 'instant';
  blendOpacity: number;
  minValidShare: number;
}

export interface ResolvedLiveEarthLayer {
  provider: LiveEarthProvider;
  time: Date;
  timeParameter: string;
  cacheKey: string;
}

export interface LiveEarthImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface LiveEarthCompositeLayer {
  id: string;
  imageData: LiveEarthImageData;
  priority: number;
  opacity?: number;
  maskBlurRadius?: number;
}

export interface LiveEarthLayerCompositeStat {
  id: string;
  validShare: number;
}

export interface LiveEarthCompositeResult {
  imageData: LiveEarthImageData;
  stats: LiveEarthLayerCompositeStat[];
}

export const LIVE_EARTH_PROVIDERS: readonly LiveEarthProvider[] = [
  {
    id: 'nasa-viirs-snpp-true-color',
    label: 'NASA VIIRS SNPP true color',
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
    wmsVersion: '1.1.1',
    layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    cadenceMinutes: 24 * 60,
    delayMinutes: 4 * 60,
    priority: 10,
    timeMode: 'day',
    blendOpacity: 0.82,
    minValidShare: 0.015,
  },
  {
    id: 'eumetview-multimission-natural',
    label: 'EUMETView Geo Ring natural color',
    endpoint: 'https://view.eumetsat.int/geoserver/wms',
    wmsVersion: '1.3.0',
    layer: 'mumi:wideareacoverage_rgb_natural',
    cadenceMinutes: 3 * 60,
    delayMinutes: 60,
    priority: 20,
    timeMode: 'instant',
    blendOpacity: 0.7,
    minValidShare: 0.015,
  },
  {
    id: 'eumetview-mtg-geocolour',
    label: 'EUMETView MTG GeoColour',
    endpoint: 'https://view.eumetsat.int/geoserver/wms',
    wmsVersion: '1.3.0',
    layer: 'mtg_fd:rgb_geocolour',
    cadenceMinutes: 10,
    delayMinutes: 50,
    priority: 70,
    timeMode: 'instant',
    blendOpacity: 0.9,
    minValidShare: 0.015,
  },
  {
    id: 'nasa-goes-west-geocolor',
    label: 'NASA GOES-West GeoColor',
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
    wmsVersion: '1.1.1',
    layer: 'GOES-West_ABI_GeoColor',
    cadenceMinutes: 10,
    delayMinutes: 50,
    priority: 80,
    timeMode: 'instant',
    blendOpacity: 0.92,
    minValidShare: 0.015,
  },
  {
    id: 'nasa-goes-east-geocolor',
    label: 'NASA GOES-East GeoColor',
    endpoint: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
    wmsVersion: '1.1.1',
    layer: 'GOES-East_ABI_GeoColor',
    cadenceMinutes: 10,
    delayMinutes: 50,
    priority: 90,
    timeMode: 'instant',
    blendOpacity: 0.92,
    minValidShare: 0.015,
  },
] as const;

const toIsoDay = (date: Date) => date.toISOString().slice(0, 10);

const toIsoMinute = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export const smoothstep = (edge0: number, edge1: number, value: number) => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
};

const roundDownToCadence = (date: Date, cadenceMinutes: number) => {
  const cadenceMs = cadenceMinutes * MINUTE_MS;
  return new Date(Math.floor(date.getTime() / cadenceMs) * cadenceMs);
};

const resolveProviderTime = (
  simulationDate: Date,
  now: Date,
  provider: LiveEarthProvider,
) => {
  const latestSafeTime = now.getTime() - provider.delayMinutes * MINUTE_MS;
  const clampedTime = Math.min(simulationDate.getTime(), latestSafeTime);
  const rounded = roundDownToCadence(new Date(clampedTime), provider.cadenceMinutes);

  if (provider.timeMode === 'day') {
    return new Date(`${toIsoDay(rounded)}T00:00:00.000Z`);
  }

  return rounded;
};

export const resolveLiveEarthLayers = (
  simulationDate: Date,
  now = new Date(),
  providers: readonly LiveEarthProvider[] = LIVE_EARTH_PROVIDERS,
): ResolvedLiveEarthLayer[] => {
  if (Math.abs(now.getTime() - simulationDate.getTime()) > LIVE_EARTH_WINDOW_MS) {
    return [];
  }

  return providers
    .map((provider) => {
      const time = resolveProviderTime(simulationDate, now, provider);
      const timeParameter = provider.timeMode === 'day' ? toIsoDay(time) : toIsoMinute(time);
      return {
        provider,
        time,
        timeParameter,
        cacheKey: `${provider.id}:${timeParameter}`,
      };
    })
    .sort((a, b) => a.provider.priority - b.provider.priority);
};

export const liveEarthTextureKey = (layers: readonly ResolvedLiveEarthLayer[]) =>
  layers.length === 0 ? 'static' : layers.map((layer) => layer.cacheKey).join('|');

export const buildLiveEarthWmsUrl = (layer: ResolvedLiveEarthLayer) => {
  const { provider } = layer;
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: provider.wmsVersion,
    LAYERS: provider.layer,
    STYLES: '',
    WIDTH: String(LIVE_EARTH_TEXTURE_WIDTH),
    HEIGHT: String(LIVE_EARTH_TEXTURE_HEIGHT),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    TIME: layer.timeParameter,
  });

  if (provider.wmsVersion === '1.1.1') {
    params.set('SRS', 'EPSG:4326');
    params.set('BBOX', '-180,-90,180,90');
  } else {
    params.set('CRS', 'CRS:84');
    params.set('BBOX', '-180,-89.9999,180,89.9999');
  }

  return `${provider.endpoint}?${params.toString()}`;
};

export const liveEarthPixelBlendAlpha = (
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): number => {
  if (alpha < 24) return 0;

  const maxChannel = Math.max(red, green, blue) / 255;
  if (maxChannel < 0.025) return 0;

  const minChannel = Math.min(red, green, blue) / 255;
  const saturation = maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  const brightnessScore = smoothstep(0.045, 0.18, luminance);
  const colorScore = smoothstep(0.04, 0.18, saturation);

  return Math.max(brightnessScore, colorScore);
};

export const blurLiveEarthMask = (
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
) => {
  if (radius <= 0) return mask;

  const horizontal = new Float32Array(mask.length);
  const output = new Float32Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = (x + offset + width) % width;
        sum += mask[y * width + sampleX];
        count += 1;
      }
      horizontal[y * width + x] = sum / count;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        sum += horizontal[sampleY * width + x];
        count += 1;
      }
      output[y * width + x] = sum / count;
    }
  }

  return output;
};

export const compositeLiveEarthLayers = (
  baseImageData: LiveEarthImageData,
  layers: readonly LiveEarthCompositeLayer[],
  maskBlurRadius = LIVE_EARTH_MASK_BLUR_RADIUS,
): LiveEarthCompositeResult => {
  const output = new Uint8ClampedArray(baseImageData.data);
  const stats: LiveEarthLayerCompositeStat[] = [];

  layers
    .filter((layer) => layer.imageData.width === baseImageData.width && layer.imageData.height === baseImageData.height)
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .forEach((layer) => {
      const { data } = layer.imageData;
      const mask = new Float32Array(baseImageData.width * baseImageData.height);
      let validSum = 0;

      for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
        const dataIndex = pixelIndex * 4;
        const alpha = liveEarthPixelBlendAlpha(
          data[dataIndex],
          data[dataIndex + 1],
          data[dataIndex + 2],
          data[dataIndex + 3],
        );
        mask[pixelIndex] = alpha;
        validSum += alpha;
      }

      const validShare = validSum / mask.length;
      stats.push({ id: layer.id, validShare });
      const blurredMask = blurLiveEarthMask(
        mask,
        baseImageData.width,
        baseImageData.height,
        layer.maskBlurRadius ?? maskBlurRadius,
      );
      const layerOpacity = layer.opacity ?? 1;

      for (let pixelIndex = 0; pixelIndex < blurredMask.length; pixelIndex += 1) {
        const dataIndex = pixelIndex * 4;
        const alpha = clamp(blurredMask[pixelIndex] * layerOpacity);
        if (alpha <= 0) continue;

        output[dataIndex] = output[dataIndex] * (1 - alpha) + data[dataIndex] * alpha;
        output[dataIndex + 1] = output[dataIndex + 1] * (1 - alpha) + data[dataIndex + 1] * alpha;
        output[dataIndex + 2] = output[dataIndex + 2] * (1 - alpha) + data[dataIndex + 2] * alpha;
        output[dataIndex + 3] = 255;
      }
    });

  return {
    imageData: {
      width: baseImageData.width,
      height: baseImageData.height,
      data: output,
    },
    stats,
  };
};
