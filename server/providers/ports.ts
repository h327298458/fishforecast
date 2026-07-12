import type { HourlyEnvironment } from '../domain/types.js';
export type Coordinates = { latitude: number; longitude: number };
export interface GeocodingProvider { search(query: string, focus?: Coordinates): Promise<Array<{ name: string; address:string; latitude: number; longitude: number; state: string; timezone:string }>> }
export interface TimezoneProvider { resolve(point: Coordinates): Promise<string> }
export interface WeatherForecastProvider { getHourly(point: Coordinates, days: number, timezone: string): Promise<Partial<HourlyEnvironment>[]> }
export interface WeatherObservationProvider { getLatest(point: Coordinates): Promise<Partial<HourlyEnvironment>|null> }
export interface MarineForecastProvider { getHourly(point: Coordinates, days: number): Promise<Partial<HourlyEnvironment>[]> }
export interface TideProvider { getHourly(point: Coordinates, days: number): Promise<Partial<HourlyEnvironment>[]> }
export interface OfficialWarningProvider { getSeverity(point: Coordinates): Promise<HourlyEnvironment['warningSeverity']> }
export interface SolarProvider { isDay(timestampUtc: string, point: Coordinates): boolean }
export interface RegulationProvider { getOfficialUrl(state: string): string }
export interface NotificationProvider { send(input: { type: string; spotId: string; conditionHash: string }): Promise<void> }
