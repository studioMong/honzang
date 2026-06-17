import type { Account, Transaction } from "@prisma/client";
import type { AppAccount, AppTransaction } from "@/types";

type TransactionWithAccounts = Transaction & {
  suggestedAccount?: Account | null;
  confirmedAccount?: Account | null;
};

export function serializeAccount(account: Account | null | undefined): AppAccount | null {
  if (!account) return null;
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    taxCategory: account.taxCategory
  };
}

export function serializeTransaction(transaction: TransactionWithAccounts): AppTransaction {
  return {
    id: transaction.id,
    sourceType: transaction.sourceType,
    transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
    description: transaction.description,
    counterparty: transaction.counterparty,
    direction: transaction.direction,
    depositAmount: Number(transaction.depositAmount),
    withdrawalAmount: Number(transaction.withdrawalAmount),
    supplyAmount: transaction.supplyAmount === null ? null : Number(transaction.supplyAmount),
    vatAmount: transaction.vatAmount === null ? null : Number(transaction.vatAmount),
    balance: transaction.balance === null ? null : Number(transaction.balance),
    suggestedAccount: serializeAccount(transaction.suggestedAccount),
    confirmedAccount: serializeAccount(transaction.confirmedAccount),
    evidenceStatus: transaction.evidenceStatus,
    memo: transaction.memo
  };
}
