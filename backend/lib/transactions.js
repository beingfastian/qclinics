import mongoose from "mongoose";

// All-or-nothing saves, shared by every module (billing, pharmacy, ...).
// work(session) runs inside one MongoDB transaction: a failure halfway leaves
// nothing behind. MongoDB retries the whole work on a write conflict (e.g. two
// receipts taking the next number at once), so work must only write through the
// session it is given. Transactions need a replica set: MongoDB Atlas always is
// one. On a standalone development server the steps run one by one instead.
let transactionsSupported = null;

export const supportsTransactions = async () => {
  if (transactionsSupported === null) {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName || hello.msg === "isdbgrid");
  }
  return transactionsSupported;
};

export const inTransaction = async (work) => {
  if (!(await supportsTransactions())) return work(undefined);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

// A duplicate key (unique index) error: who wins when two saves race
export const isDuplicateKey = (error) => error?.code === 11000;
