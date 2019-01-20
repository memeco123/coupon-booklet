const LISTENER_OPTS = {
    once: true,
    passive: true
};
const STORE = 'coupons';

//TODO context menu item that pre-fills add form with selection and current URL
//TODO highlight items for current host (and badge!)
//TODO option to define URL aliases
//TODO support coupon websites and pre-fill more info from that (content script)
//TODO support being loaded in a sidebar and communicating with a potential popup

function waitForRequest(request) {
    return new Promise((resolve, reject) => {
        request.addEventListener("success", resolve, LISTENER_OPTS);
        request.addEventListener("error", reject, LISTENER_OPTS);
    });
}

function expunge(database) {
    // could do this in worker...
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.delete(IDBKeyRange.bound(new Date(0), new Date(Date.now() - 86400000), true, false));
    return waitForRequest(request);
}

Promise.all([
    new Promise((resolve, reject) => {
        try {
            const request = window.indexedDB.open(STORE, 1);
            request.addEventListener("upgradeneeded", (e) => {
                const coupons = e.target.result.createObjectStore(STORE, {
                    keyPath: 'id',
                    autoIncrement: true
                });
                coupons.createIndex('pagecoupon', [
                    'coupon',
                    'host'
                ], { unique: true });
                coupons.createIndex('page', 'host', { unique: false });
                coupons.createIndex('expires', 'expires', { unique: false });
            }, { once: true, passive: true });
            resolve(waitForRequest(request)
                .then((e) => Promise.all([ e, expunge(e.target.result) ]))
                .then(([ e ]) => e.target.result));
        }
        catch(e) {
            reject(e);
            // can't open DB
        }
    }),
    new Promise((resolve) => {
        document.addEventListener("DOMContentLoaded", resolve, LISTENER_OPTS);
    })
])
    .then(([ database ]) => {
        const now = new Date();
        document.querySelector("#expiryDate").min = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
        function showAdd() {
            document.querySelector("#addcoupon").hidden = false;
            document.querySelector("ul").hidden = true;
            document.querySelector("header").hidden = true;
            document.querySelector("#add").hidden = true;
        }

        function hideAdd() {
            document.querySelector("#addcoupon").hidden = true;
            document.querySelector("ul").hidden = false;
            document.querySelector("header").hidden = false;
            document.querySelector("#add").hidden = false;
            //TODO reset form
            loadCoupons();
        }

        function addCoupon(e) {
            e.preventDefault();
            const coupon = {
                coupon: document.querySelector("#code").value,
                host: (new URL(document.querySelector("#website").value)).hostname,
                notes: document.querySelector("#notes").value
            };
            const expiry = document.querySelector("#expiryDate");
            if(expiry.value) {
                coupon.expires = expiry.valueAsDate;
            }
            else {
                coupon.expires = new Date(0);
            }
            const transaction = database.transaction(STORE, 'readwrite');
            const store = transaction.objectStore(STORE);
            const req = store.add(coupon);

            waitForRequest(req)
                .then(hideAdd)
                .catch(console.error);
        }

        function removeCoupon(id) {
            const transaction = database.transaction(STORE, 'readwrite');
            const store = transaction.objectStore(STORE);
            const req = store.delete(id);
            waitForRequest(req)
                .then(loadCoupons)
                .catch(console.error);
        }

        function loadCoupons() {
            console.log("reload");
            const list = document.querySelector("main > ul");
            while(list.firstElementChild) {
                list.firstElementChild.remove();
            }

            const transaction = database.transaction(STORE);
            const store = transaction.objectStore(STORE);
            const request = store.openCursor();
            const coupons = {};

            request.addEventListener("success", (e) => {
                const cursor = e.target.result;
                if(cursor) {
                    const { value } = cursor;
                    if(!coupons.hasOwnProperty(value.host)) {
                        coupons[value.host] = [];
                    }
                    coupons[value.host].push(value);
                    cursor.continue();
                }
                else {
                    let addedSome = false;
                    for(const host in coupons) {
                        if(coupons.hasOwnProperty(host)) {
                            addedSome = true;
                            const hostItem = document.createElement("li");
                            const hostSummary = document.createElement("summary");
                            hostSummary.append(document.createTextNode(host));
                            const open = document.createElement("button");
                            open.classList.add('browser-style');
                            open.textContent = 'visit';
                            open.title = 'Open coupon shop';
                            open.addEventListener("click", (e) => {
                                e.preventDefault();
                                browser.tabs.create({
                                    url: `https://${host}`
                                }).then(() => {
                                    window.close();
                                });
                            }, { passive: false, once: true });
                            hostSummary.append(open);

                            const hostDetails = document.createElement("details");
                            hostDetails.append(hostSummary);

                            const couponCodes = document.createElement("ul");
                            for(const code of coupons[host]) {
                                const codeItem = document.createElement("li");
                                codeItem.append(document.createTextNode(code.coupon));
                                if(code.expires > new Date(0)) {
                                    codeItem.title = `Expires ${code.expires.toLocaleDateString()}`;
                                }
                                if(code.notes) {
                                    if(codeItem.title) {
                                        codeItem.title += ' - ';
                                    }
                                    codeItem.title += code.notes;
                                }

                                const buttonGroup = document.createElement("span");
                                buttonGroup.classList.add('button-group');
                                const copy = document.createElement("button");
                                copy.textContent = "copy";
                                copy.title = "Copy coupon code";
                                copy.classList.add('browser-style');
                                copy.classList.add('default');
                                copy.addEventListener("click", () => {
                                    navigator.clipboard.writeText(code.coupon);
                                    //TODO tell the user that it was copied
                                }, { passive: true });
                                const remove = document.createElement("button");
                                remove.textContent = '×';
                                remove.title ="Delete coupon";
                                remove.classList.add('browser-style');
                                remove.addEventListener("click", () => {
                                    removeCoupon(code.id);
                                }, { passive: true });
                                buttonGroup.append(remove);
                                buttonGroup.append(copy);
                                codeItem.append(buttonGroup);

                                couponCodes.append(codeItem);
                            }

                            hostDetails.append(couponCodes);
                            hostItem.append(hostDetails)

                            list.append(hostItem);
                        }
                    }
                    if(!addedSome) {
                        const empty = document.createElement("li");
                        empty.textContent = "No coupons saved yet. Add some with the button above.";
                        list.append(empty);
                    }
                }
            });
            request.addEventListener("error", (e) => {
                //TODO handle erros
                console.error(e);
            });
        }

        // init
        document.querySelector("#add").addEventListener("click", showAdd, { passive: true });
        document.querySelector("form").addEventListener("submit", addCoupon, { passive: false });
        document.querySelector("#back").addEventListener("click", hideAdd, { passive: true });
        loadCoupons();
    })
    .catch(console.error);
