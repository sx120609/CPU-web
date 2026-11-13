import common from '@ohos.app.ability.common';
import { BusinessError } from '@kit.BasicServicesKit';
import { iap } from '@kit.IAPKit';

/**
 * 华为应用内支付（IAP Kit）给网页赞助页用的一层薄桥。页面（/sponsor/app）负责界面、向服务端交单和决定何时确认发货，
 * 这里只把 IAP Kit 的五个动作原样转出去，结果都是 JSON：成功 `{ ok: true, ... }`，失败 `{ ok: false, code, message }`。
 *
 * - environment：当前华为账号所在地能不能用应用内支付。
 * - products { productIds }：开发者中心里配置的消耗型商品（名称、展示价格）。
 * - purchase { productId, developerPayload }：拉起收银台，成功返回 purchaseData（含 jwsPurchaseOrder，交给服务端验签）。
 * - unfinished：已付款但还没确认发货的订单，页面打开时和购买返回“已拥有”“系统错误”时补交。
 * - finish { purchaseToken, purchaseOrderId }：服务端记账成功后确认发货，之后才能再买同一个商品。
 */
export const IAP_ACTIONS: string[] = ['environment', 'products', 'purchase', 'unfinished', 'finish'];

interface IapRequestPayload {
  productIds?: string[];
  productId?: string;
  developerPayload?: string;
  purchaseToken?: string;
  purchaseOrderId?: string;
}

interface IapProductView {
  id: string;
  name: string;
  description: string;
  localPrice: string;
  microPrice: number;
  currency: string;
}

interface IapReply {
  ok: boolean;
  code?: number;
  message?: string;
  products?: IapProductView[];
  purchaseData?: string;
  purchaseDataList?: string[];
}

const MAX_PRODUCTS = 20;
const MAX_UNFINISHED_PAGES = 5;

function failure(code: number, message: string): string {
  const reply: IapReply = { ok: false, code, message };
  return JSON.stringify(reply);
}

function failureOf(error: Object | undefined): string {
  const business = error as BusinessError | undefined;
  return failure(Number(business?.code) || -1, String(business?.message ?? ''));
}

function cleanId(value: string | undefined): string {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9._-]{1,256}$/.test(text) ? text : '';
}

function parsePayload(payload: string): IapRequestPayload {
  try {
    return (JSON.parse(payload || '{}') as IapRequestPayload) ?? {};
  } catch (_) {
    return {};
  }
}

async function unfinishedPurchases(context: common.UIAbilityContext): Promise<string[]> {
  const list: string[] = [];
  let token: string | undefined = undefined;
  for (let page = 0; page < MAX_UNFINISHED_PAGES; page += 1) {
    const parameter: iap.QueryPurchasesParameter = {
      productType: iap.ProductType.CONSUMABLE,
      queryType: iap.PurchaseQueryType.UNFINISHED,
      continuationToken: token
    };
    const result = await iap.queryPurchases(context, parameter);
    (result.purchaseDataList ?? []).forEach((item: string) => list.push(item));
    token = result.continuationToken;
    if (!token) break;
  }
  return list;
}

export async function runIapRequest(context: common.UIAbilityContext | undefined, action: string, payload: string): Promise<string> {
  if (!context) return failure(-2, 'context unavailable');
  const request = parsePayload(payload);
  try {
    if (action === 'environment') {
      await iap.queryEnvironmentStatus(context);
      const reply: IapReply = { ok: true };
      return JSON.stringify(reply);
    }
    if (action === 'products') {
      const ids = (Array.isArray(request.productIds) ? request.productIds : [])
        .map((id: string) => cleanId(id)).filter((id: string) => id.length > 0).slice(0, MAX_PRODUCTS);
      if (!ids.length) return failure(-3, 'no products');
      const parameter: iap.QueryProductsParameter = { productType: iap.ProductType.CONSUMABLE, productIds: ids };
      const products = await iap.queryProducts(context, parameter);
      const reply: IapReply = {
        ok: true,
        products: products.map((product: iap.Product): IapProductView => ({
          id: product.id,
          name: product.name ?? '',
          description: product.description ?? '',
          localPrice: product.localPrice ?? '',
          microPrice: Number(product.microPrice) || 0,
          currency: product.currency ?? ''
        }))
      };
      return JSON.stringify(reply);
    }
    if (action === 'purchase') {
      const productId = cleanId(request.productId);
      if (!productId) return failure(-3, 'no product');
      const parameter: iap.PurchaseParameter = {
        productId,
        productType: iap.ProductType.CONSUMABLE,
        developerPayload: String(request.developerPayload ?? '').slice(0, 256)
      };
      const result = await iap.createPurchase(context, parameter);
      const reply: IapReply = { ok: true, purchaseData: result.purchaseData };
      return JSON.stringify(reply);
    }
    if (action === 'unfinished') {
      const reply: IapReply = { ok: true, purchaseDataList: await unfinishedPurchases(context) };
      return JSON.stringify(reply);
    }
    if (action === 'finish') {
      const purchaseToken = String(request.purchaseToken ?? '');
      const purchaseOrderId = String(request.purchaseOrderId ?? '');
      if (!purchaseToken || !purchaseOrderId) return failure(-3, 'no order');
      const parameter: iap.FinishPurchaseParameter = {
        productType: iap.ProductType.CONSUMABLE,
        purchaseToken,
        purchaseOrderId
      };
      try {
        await iap.finishPurchase(context, parameter);
      } catch (error) {
        // 已经确认过发货的订单再确认一次不算失败。
        if (Number((error as BusinessError)?.code) !== iap.IAPErrorCode.PURCHASE_FINISHED) return failureOf(error as Object);
      }
      const reply: IapReply = { ok: true };
      return JSON.stringify(reply);
    }
    return failure(-4, 'unknown action');
  } catch (error) {
    return failureOf(error as Object);
  }
}
