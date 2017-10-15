// @flow

import _ from "lodash";
import Formats from "../../src/lib/formats";
import moment from "moment";
import Promise from "bluebird"; // old classes using this currently rely on the returned promises to be from bluebird :(

class DataStore {
  data: Object;

  constructor(config: Object) {
    this.data = config ? config.data || {} : {};
  }

  save(type: string, data: Object) {
    if (data.id || data.objectId) {
      return this.update(type, data);
    } else {
      return this.insert(type, data);
    }
  }

  saveAll(type: string, data: Object) {
    var saves = [];

    for (let item of data) {
      if (item.id || item.objectId) {
        saves.push(this.update(type, item));
      } else {
        saves.push(this.insert(type, item));
      }
    }

    return Promise.all(saves).then(saves => this.batchResult(saves));
  }

  batchResult(items: Array<Object>) {
    return items.map(item => {
      return {
        success: {
          createdAt: moment().toISOString(),
          objectId: item.objectId
        }
      };
    });
  }

  insert(type: string, data: Object) {
    if (!this.data[type]) this.data[type] = {};
    data.objectId = type + Math.floor(Math.random() * 10000000000);
    this.data[type][data.objectId] = data;
    this.data[`${type}-last`] = data;
    return Promise.resolve(data);
  }

  batchInsert(type: string, data: Object) {
    var saves = [];

    for (let item of data) {
      saves.push(this.insert(type, item));
    }

    return Promise.all(saves).then(saves => this.batchResult(saves));
  }

  updateAll(type: string, data: Object) {
    var saves = [];

    _.each(data, item => {
      saves.push(this.update(type, item));
    });

    return Promise.all(saves).then(saves => this.batchResult(saves));
  }

  signup(email: string, password: string) {
    var user = {
      objectId: Date.now() + "user",
      email: email,
      username: email,
      password: password,
      sessionToken: "r:" + Date.now() + "user"
    };
    this.data["_User"][user.objectId] = user;
    return Promise.resolve(user);
  }

  update(type: string, data: Object) {
    if (!data.objectId) {
      console.log("Can’t update an object without an objectId", type, data);
      Promise.reject(
        new Error("Can't update an object without objectId ${type}")
      );
    }

    this.data[type] = this.data[type] || [];

    var objectToUpdate = this.data[type][data.objectId];
    if (objectToUpdate) {
      objectToUpdate = _.extend(objectToUpdate, _.omit(data, "objectId"));
    }

    return Promise.resolve(data);
  }

  async getOne(type: string, id: string | Object) {
    if (!this.data[type]) this.data[type] = [];
    var all: Object = this.data[type];

    if (typeof id === "object") {
      let result = await this.query(
        { type, include: id.include },
        { objectId: id.objectId }
      );

      if (result.results.length < 1) {
        return Promise.reject(
          new Error("object not found " + type + " " + id.objectId)
        );
      }
      return result.results[0];
    }

    if (all[id]) {
      return Promise.resolve(all[id]);
    }

    return Promise.reject(new Error("object not found " + type + " " + id));
  }

  delete(type: string, id: string) {
    if (!this.data[type]) this.data[type] = [];

    var all = this.data[type];

    for (var i in all) {
      var object = all[i];
      if (object.id === id || object.objectId === id) {
        delete this.data[type][i];
        return Promise.resolve(object);
      }
    }

    return Promise.reject(new Error("object not found " + type + " " + id));
  }

  login(username: string, password: string) {
    var users = _.values(this.data["_User"]);

    var user = _.find(users, function(user) {
      return user.username === username && user.password === password;
    });

    if (!user) {
      return Promise.reject(new Error("login failed"));
    }

    return Promise.resolve(user);
  }

  getAll(type: string) {
    var all = [];
    if (type) {
      all = this.data[type];
      if (typeof all === "object") {
        all = _.values(all);
      }
    }

    return Promise.resolve({ results: all });
  }

  uploadFile(options: Object) {
    return new Promise((resolve, reject) => {
      if (!options.buffer) {
        return reject(new Error("File buffer is required"));
      }
      var name = "ftss-" + Date.now() + "-" + options.name;
      var url = "http://files.parsetfss.com/" + name;
      resolve({ name, url });
    });
  }

  /*
  Execute operator filters on the datastore.

  objects ... objects that need to be filtered
  operator ... comparison operator that the datastore should support
  accessor ... object property that should be compared (e.g. 'createdAt')
  comparator ... value that the property should be compared with
  */
  processOperator(
    objects: Array<Object>,
    operator: string,
    accessor: string,
    comparator: Object
  ) {
    if (!operator || comparator === undefined) {
      return objects;
    }

    objects = _.filter(objects, function(o) {
      /*
      Date type operators.
      */
      if (
        o &&
        o[accessor] &&
        o[accessor].__type &&
        o[accessor].__type === "Date"
      ) {
        var dateAccessor = moment(o[accessor].iso);
        var dateComparator = moment(comparator.iso);
        var diff = dateAccessor.diff(dateComparator);
        if (operator === "$gte") {
          return diff >= 0;
        }

        if (operator === "$gt") {
          return diff > 0;
        }

        if (operator === "$lte") {
          return diff <= 0;
        }

        if (operator === "$lt") {
          return diff < 0;
        }
      }

      /*
      General type operators.
      */
      if (operator === "$gte") {
        return o[accessor] >= comparator;
      }

      if (operator === "$gt") {
        return o[accessor] > comparator;
      }

      if (operator === "$lte") {
        return o[accessor] <= comparator;
      }

      if (operator === "$lt") {
        return o[accessor] < comparator;
      }

      if (operator === "$in") {
        if (!o[accessor]) {
          return false;
        }

        let includes = false;

        if (Array.isArray(o[accessor]) && Array.isArray(comparator)) {
          // for arrays, we're good if the field has one of the comparators included
          comparator.forEach(c => {
            if (o[accessor].includes(c)) {
              includes = true;
            }
          });
        } else {
          includes = comparator.includes(o[accessor]);
        }

        return includes;
      }

      if (operator === "$exists") {
        return o[accessor] ? comparator : !comparator;
      }

      if (operator === "$regex") {
        let cleanedComparator = comparator
          .replace("\\Q", "")
          .replace("\\E", ""); // remove unsupported regex chars
        return o && o[accessor].match(cleanedComparator) ? true : false;
      }
    });

    return objects;
  }

  capitalizeFirstLetter(word: string) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  getIncludeParts(includes: string, baseObject: Object) {
    return _.map(includes.split(","), i => {
      if (baseObject[i]) {
        return {
          property: i,
          className: baseObject[i].className,
          __type: baseObject[i].__type,
          objectId: baseObject[i].objectId
        };
      }
      // lots of tests rely on queries that include something that isn't mocked correctly, so deliver base info for them
      return {
        property: i,
        className: undefined,
        __type: undefined,
        objectId: undefined
      };
    });
  }

  queryAll(config: Object, params: Object) {
    return this.query(config, params);
  }

  count(type: string | Object, params: Object) {
    return this.query(type, params).then((res: Object) => {
      res.count = res.results.length;
      return res;
    });
  }

  async query(config: Object | string, params: Object) {
    let all = {};
    const type = typeof config === "object" ? config.type : config;

    all = this.data[type];

    var include = typeof config === "object" ? config["include"] : undefined;
    if (include) {
      // include … resolve parse style pointers to data contained in the mock
      for (var o in all) {
        for (var includePart of this.getIncludeParts(include, all[o])) {
          if (this.data[includePart.className]) {
            if (includePart.__type === "Pointer") {
              all[o][includePart.property] = this.data[includePart.className][
                includePart.objectId
              ];
            }
          } else if (this.data[type][o]) {
            if (typeof config === "object") {
              var pointer = all[o][config[includePart]];
              if (pointer && pointer.__type === "Pointer") {
                all[o][includePart] = this.data[pointer["className"]][
                  pointer["objectId"]
                ];
              }
            }
          } else {
            console.log(
              "MOCK ERROR: Could not find data that should be included in mock dataStore",
              includePart
            );
          }
        }
      }
    }

    for (let q in params) {
      // q is a part of the queries 'where' clause

      if (q.indexOf(".") !== -1) {
        let path = q.split(".");
        params[path[0]] = { [path[1]]: [params[q]] };
        delete params[q];
      }

      if (all && params[q] && params[q].__type === "Pointer") {
        /**
         * This checks the queries 'where' part, e.g. check bookings where the partner has a certain objectId.
         * The 'filtered' is an Array in this case, because it’s fed directly into { results: filtered }.
         */
        var filtered = [];
        let targetPointerObjectId = params[q].objectId;
        for (let referenceEntity of Object.values(all)) {
          if (
            referenceEntity &&
            typeof referenceEntity === "object" &&
            typeof referenceEntity[q] === "object"
          ) {
            if (
              referenceEntity[q] &&
              referenceEntity[q].objectId === targetPointerObjectId
            ) {
              filtered.push(referenceEntity);
            }
          } else {
            if (
              referenceEntity &&
              typeof referenceEntity === "object" &&
              referenceEntity[q]
            ) {
              // it might be that some objects just don't have the object that is asked to be included, e.g. FeedItems without companies
              console.log(
                "MOCK ERROR: When checking pointers, something other than an Object was encountered. This is likely a test setup error.",
                referenceEntity,
                q
              );
            }
          }
        }

        all = filtered;
        delete params[q];
      } else {
        for (let operator of [
          "$gte",
          "$lte",
          "$gt",
          "$lt",
          "$in",
          "$exists",
          "$regex",
          "$or"
        ]) {
          if (
            operator === "$or" &&
            params[operator] &&
            Array.isArray(params[operator])
          ) {
            let filteredOrPart = params[operator].filter(v => v != {});

            all = [];
            let subQueryConfig = config;
            if (typeof subQueryConfig === "object") {
              // do not skip on subqueries, but instead skip on the result
              subQueryConfig = Object.assign({}, subQueryConfig);
              delete subQueryConfig.skip;
            }

            for (let orPart of filteredOrPart) {
              let subQuery = await this.query(subQueryConfig, orPart);
              all = all.concat(subQuery.results);
            }
            delete params[operator];
          }

          if (params[q] && params[q][operator] !== undefined) {
            all = this.processOperator(all, operator, q, params[q][operator]);
            delete params[q][operator];

            if (_.isEmpty(params[q])) {
              delete params[q];
            }
          }
        }
      }
    }

    if (!_.isEmpty(params)) {
      all = _.filter(all, o => {
        return _.reduce(
          params,
          (result, value, key) => {
            // If you send a Parse query like { countries: 'AT' }, and countries is an Array in Parse, e.g. ['AT', 'CH'],
            // it assumes you want to check if the value ('AT') is included in the Array (['AT', 'CH']).
            // This is why `all = _.filter(all, params);` is not enough.
            return (
              result &&
              (_.isEqual(o[key], value) ||
                (Array.isArray(o[key]) && _.includes(o[key], value)))
            );
          },
          {}
        );
      });
    }

    if (!Array.isArray(all)) {
      // The results are likely still an object from the mocks at this point, most likely because the query didn't specify a filter, so convert it.
      all = _.values(all);
    }

    if (config && typeof config === "object" && config["order"]) {
      // support ordering results
      all = this.orderQuery(all, config["order"]);
    }

    if (typeof config === "object") {
      let { limit, skip } = config;
      if (all && Array.isArray(all)) {
        if (skip) {
          all = all.slice(skip);
        }

        if (limit) {
          all = all.slice(0, limit);
        }
      }
    }

    return { results: all };
  }

  // Order query results
  orderQuery(all: Array<Object>, orderBy: string): Array<Object> {
    let sortElement = orderBy.substr(1, orderBy.length);
    all.sort((a, b) => {
      let aElement = a[sortElement];
      let bElement = b[sortElement];

      if (aElement && aElement.__type && aElement.__type === "Date") {
        aElement = Formats.fromParseDate(aElement);
        bElement = Formats.fromParseDate(bElement);
      }

      if (orderBy.charAt(0) === "-") {
        return bElement - aElement;
      }
      return aElement - bElement;
    });
    return all;
  }
}

module.exports = DataStore;
