import type {
  ActiveStatusBatch, BatchCompleted, MerchantDetailRead, MerchantInput, MerchantUpdate,
  OperatorInput, OperatorUpdate, OperatorRead, PageResultMerchantRead, PageResultOperatorRead,
  PageResultReceivableRead, PageResultSettlementRead, PropertyTargetRead, SettlementCreate,
  SettlementPayment, SettlementRead, SettlementReversal, SettlementEventRead,
} from "@pinjie/api-client";
import { apiRequest, jsonBody } from "./http";

export const localCommerceApi = {
  merchants: (page = 1, search = "") => apiRequest<PageResultMerchantRead>(`/api/v1/admin/merchants?page=${page}&page_size=20&search=${encodeURIComponent(search)}`),
  merchant: (id: string) => apiRequest<MerchantDetailRead>(`/api/v1/admin/merchants/${id}`),
  createMerchant: (data: MerchantInput) => apiRequest<MerchantDetailRead>("/api/v1/admin/merchants", { method: "POST", body: jsonBody(data) }),
  updateMerchant: (id: string, data: MerchantUpdate) => apiRequest<MerchantDetailRead>(`/api/v1/admin/merchants/${id}`, { method: "PUT", body: jsonBody(data) }),
  merchantStatus: (data: ActiveStatusBatch) => apiRequest<BatchCompleted>("/api/v1/admin/merchants/status/batch", { method: "PATCH", body: jsonBody(data) }),
  operators: (page = 1, search = "") => apiRequest<PageResultOperatorRead>(`/api/v1/admin/property-operators?page=${page}&page_size=20&search=${encodeURIComponent(search)}`),
  createOperator: (data: OperatorInput) => apiRequest<OperatorRead>("/api/v1/admin/property-operators", { method: "POST", body: jsonBody(data) }),
  updateOperator: (id: string, data: OperatorUpdate) => apiRequest<OperatorRead>(`/api/v1/admin/property-operators/${id}`, { method: "PUT", body: jsonBody(data) }),
  operatorStatus: (data: ActiveStatusBatch) => apiRequest<BatchCompleted>("/api/v1/admin/property-operators/status/batch", { method: "PATCH", body: jsonBody(data) }),
  lookup: (phone_e164: string) => apiRequest<PropertyTargetRead>("/api/v1/admin/property-operators/lookup-user", { method: "POST", body: jsonBody({ phone_e164 }) }),
  receivables: (page = 1, merchant = "") => apiRequest<PageResultReceivableRead>(`/api/v1/admin/merchant-receivables?page=${page}&page_size=20${merchant ? `&merchant_id=${encodeURIComponent(merchant)}` : ""}`),
  settlements: (page = 1, merchant = "") => apiRequest<PageResultSettlementRead>(`/api/v1/admin/merchant-settlements?page=${page}&page_size=20${merchant ? `&merchant_id=${encodeURIComponent(merchant)}` : ""}`),
  createSettlement: (data: SettlementCreate) => apiRequest<SettlementRead>("/api/v1/admin/merchant-settlements", { method: "POST", body: jsonBody(data) }),
  paySettlement: (id: string, data: SettlementPayment) => apiRequest<SettlementRead>(`/api/v1/admin/merchant-settlements/${id}/payment`, { method: "POST", body: jsonBody(data) }),
  reverseSettlement: (id: string, data: SettlementReversal) => apiRequest<SettlementRead>(`/api/v1/admin/merchant-settlements/${id}/reversal`, { method: "POST", body: jsonBody(data) }),
  settlementHistory: (id: string) => apiRequest<SettlementEventRead[]>(`/api/v1/admin/merchant-settlements/${id}/history`),
};
