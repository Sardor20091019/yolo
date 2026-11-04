import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AlertIncident, AlertMetrics } from '../models/alert.model';
import { getApiBaseUrl } from './api-config';

@Injectable({
  providedIn: 'root',
})
export class AlertsService {
  private readonly baseUrl: string;
  public readonly alerts: WritableSignal<AlertIncident[]> = signal<AlertIncident[]>([]);
  public readonly metrics: WritableSignal<AlertMetrics> = signal<AlertMetrics>({
    total: 0,
    newCount: 0,
    confirmedCount: 0,
    highRiskCount: 0,
  });
  public readonly loading: WritableSignal<boolean> = signal<boolean>(false);

  constructor(private readonly http: HttpClient) {
    this.baseUrl = `${getApiBaseUrl()}/alerts`;
  }

  public fetchAlerts(status?: string): Observable<AlertIncident[]> {
    this.loading.set(true);
    let url = this.baseUrl;
    if (status && status !== 'ALL') {
      url += `?status=${status}`;
    }
    return this.http.get<AlertIncident[]>(url).pipe(
      tap({
        next: (items) => {
          this.alerts.set(items);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      }),
    );
  }

  public fetchMetrics(): Observable<AlertMetrics> {
    return this.http.get<AlertMetrics>(`${this.baseUrl}/metrics`).pipe(
      tap((metrics) => {
        this.metrics.set(metrics);
      }),
    );
  }

  public updateStatus(id: string, status: AlertIncident['status']): Observable<AlertIncident> {
    return this.http.patch<AlertIncident>(`${this.baseUrl}/${id}/status`, { status }).pipe(
      tap((updated) => {
        this.alerts.update((items) =>
          items.map((item) => (item.id === id ? updated : item)),
        );
        this.fetchMetrics().subscribe();
      }),
    );
  }

  public deleteAlert(id: string): Observable<{ success: boolean; id: string }> {
    return this.http.delete<{ success: boolean; id: string }>(`${this.baseUrl}/${id}`).pipe(
      tap(() => {
        this.alerts.update((items) => items.filter((item) => item.id !== id));
        this.fetchMetrics().subscribe();
      }),
    );
  }

  public prependAlert(alert: AlertIncident): void {
    this.alerts.update((items) => [alert, ...items]);
    this.fetchMetrics().subscribe();
  }
}

