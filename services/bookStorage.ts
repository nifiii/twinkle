import { EBook } from '../types';

const DB_NAME = 'HomeLearningOS';
const DB_VERSION = 1;
const BOOKS_STORE_NAME = 'books';

/**
 * 初始化 IndexedDB
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('无法打开 IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 创建图书对象存储（如果不存在）
      if (!db.objectStoreNames.contains(BOOKS_STORE_NAME)) {
        const objectStore = db.createObjectStore(BOOKS_STORE_NAME, {
          keyPath: 'id',
        });

        // 创建索引
        objectStore.createIndex('ownerId', 'ownerId', { unique: false });
        objectStore.createIndex('subject', 'subject', { unique: false });
        objectStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
      }
    };
  });
}

/**
 * 保存图书到 IndexedDB
 */
export async function saveBook(book: EBook): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOKS_STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);
    const request = objectStore.put(book);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('保存图书失败'));
    };
  });
}

/**
 * 获取所有图书
 */
export async function getAllBooks(): Promise<EBook[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOKS_STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);
    const request = objectStore.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('获取图书列表失败'));
    };
  });
}

/**
 * 根据用户 ID 获取图书
 */
export async function getBooksByOwnerId(ownerId: string): Promise<EBook[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOKS_STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);
    const index = objectStore.index('ownerId');
    const request = index.getAll(ownerId);

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('获取用户图书失败'));
    };
  });
}

/**
 * 根据 ID 获取单本图书
 */
export async function getBookById(id: string): Promise<EBook | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOKS_STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);
    const request = objectStore.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error('获取图书失败'));
    };
  });
}

/**
 * 更新图书信息
 */
export async function updateBook(book: Partial<EBook> & { id: string }): Promise<void> {
  const db = await openDB();
  return new Promise(async (resolve, reject) => {
    // 先获取原有数据
    const existingBook = await getBookById(book.id);
    if (!existingBook) {
      reject(new Error('图书不存在'));
      return;
    }

    // 合并更新
    const updatedBook = { ...existingBook, ...book };

    const transaction = db.transaction([BOOKS_STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);
    const request = objectStore.put(updatedBook);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('更新图书失败'));
    };
  });
}

/**
 * 删除图书
 */
export async function deleteBook(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOKS_STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);
    const request = objectStore.delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('删除图书失败'));
    };
  });
}

/**
 * 清空所有图书
 */
export async function clearAllBooks(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOKS_STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);
    const request = objectStore.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('清空图书失败'));
    };
  });
}

/**
 * 批量保存图书
 */
export async function saveBooksInBatch(books: EBook[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOKS_STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(BOOKS_STORE_NAME);

    let completed = 0;
    const total = books.length;

    books.forEach((book) => {
      const request = objectStore.put(book);
      request.onsuccess = () => {
        completed++;
        if (completed === total) {
          resolve();
        }
      };
      request.onerror = () => {
        reject(new Error('批量保存图书失败'));
      };
    });

    if (total === 0) {
      resolve();
    }
  });
}
