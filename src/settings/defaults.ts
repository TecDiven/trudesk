/*
      .                              .o8                     oooo
   .o8                             "888                     `888
 .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
   888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
   888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
   888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
   "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 ========================================================================
 Created:    02/24/18
 Author:     Chris Brame

 **/

import async, { series } from 'async'
import fs from 'fs-extra'
import _ from 'lodash'
import moment from 'moment-timezone'
import type { Types } from "mongoose"
import path from 'path'
import config from '../config'
import { trudeskDatabase } from '../database'
import winston from '../logger'
import { PriorityModel, RoleModel, SettingModel, TicketModel, TicketStatusModel, TicketTagModel, TicketTypeModel } from '../models'
import type { TicketTypeClass } from "../models/tickettype"
import { TicketStatusClass } from '../models/ticketStatus'

type DefaultGrants = {
  userGrants: Array<string>
  supportGrants: Array<string>
  adminGrants: Array<string>
}

type SettingsDefaults = {
  init?: (callback: any) => void
  roleDefaults?: DefaultGrants
}

const settingsDefaults : SettingsDefaults = {}
const roleDefaults: DefaultGrants = {
  userGrants: ['tickets:create view update', 'comments:create view update'],
  supportGrants: [
    'tickets:*',
    'agent:*',
    'accounts:create update view import',
    'teams:create update view',
    'comments:create view update create delete',
    'reports:view create',
    'notices:*',
  ],
  adminGrants: [
    'admin:*',
    'agent:*',
    'chat:*',
    'tickets:*',
    'accounts:*',
    'groups:*',
    'teams:*',
    'departments:*',
    'comments:*',
    'reports:*',
    'notices:*',
    'settings:*',
    'api:*',
  ],
}

settingsDefaults.roleDefaults = roleDefaults

function rolesDefault(callback: () => void) {
  async.series(
    [
      function (done) {
        RoleModel.getRoleByName('User', function (err, role) {
          if (err) return done(err)
          if (role) return done()

          RoleModel.create(
            {
              name: 'User',
              description: 'Default role for users',
              grants: roleDefaults.userGrants,
            },
            function (err, userRole) {
              if (err) return done(err)
              SettingModel.getSettingByName('role:user:default', function (err, roleUserDefault) {
                if (err) return done(err)
                if (roleUserDefault) return done()

                SettingModel.create(
                  {
                    name: 'role:user:default',
                    value: userRole._id,
                  },
                  done
                )
              })
            }
          )
        })
      },
      function (done) {
        RoleModel.getRoleByName('Support', function (err, role) {
          if (err) return done(err)
          if (role) {
            return done()
            // role.updateGrants(supportGrants, done);
          } else
            RoleModel.create(
              {
                name: 'Support',
                description: 'Default role for agents',
                grants: roleDefaults.supportGrants,
              },
              done
            )
        })
      },
      function (done) {
        RoleModel.getRoleByName('Admin', function (err, role) {
          if (err) return done(err)
          if (role) return done()
          // role.updateGrants(adminGrants, done);
          else {
            RoleModel.create(
              {
                name: 'Admin',
                description: 'Default role for admins',
                grants: roleDefaults.adminGrants,
              },
              done
            )
          }
        })
      },
      function (done) {
        var roleOrderSchema = require('../models/roleorder')
        roleOrderSchema.getOrder(function (err, roleOrder) {
          if (err) return done(err)
          if (roleOrder) return done()

          RoleModel.getRoles(function (err, roles) {
            if (err) return done(err)

            var roleOrder = []
            roleOrder.push(_.find(roles, { name: 'Admin' })._id)
            roleOrder.push(_.find(roles, { name: 'Support' })._id)
            roleOrder.push(_.find(roles, { name: 'User' })._id)

            roleOrderSchema.create(
              {
                order: roleOrder,
              },
              done
            )
          })
        })
      },
    ],
    function (err) {
      if (err) throw err

      return callback()
    }
  )
}

function defaultUserRole(callback) {
  var roleOrderSchema = require('../models/roleorder')
  roleOrderSchema.getOrderLean(function (err, roleOrder) {
    if (err) return callback(err)
    if (!roleOrder) return callback()

    SettingModel.getSettingByName('role:user:default', function (err, roleDefault) {
      if (err) return callback(err)
      if (roleDefault) return callback()

      var lastId = _.last(roleOrder.order)
      SettingModel.create(
        {
          name: 'role:user:default',
          value: lastId,
        },
        callback
      )
    })
  })
}

function createDirectories(callback) {
  async.parallel(
    [
      function (done) {
        fs.ensureDir(path.resolve(config.trudeskRoot(), 'backups'), done)
      },
      function (done) {
        fs.ensureDir(path.resolve(config.trudeskRoot(), 'restores'), done)
      },
    ],
    callback
  )
}

function downloadWin32MongoDBTools(callback) {
  var http = require('http')
  var os = require('os')
  var semver = require('semver')
  const dbVersion = trudeskDatabase.version || '5.0.6'
  var fileVersion = semver.major(dbVersion) + '.' + semver.minor(dbVersion)

  if (os.platform() === 'win32') {
    winston.debug('MongoDB version ' + fileVersion + ' detected.')
    var filename = 'mongodb-tools.' + fileVersion + '-win32x64.zip'
    var savePath = path.resolve(config.trudeskRoot(), 'src/backup/bin/win32/')
    fs.ensureDirSync(savePath)
    if (
      !fs.existsSync(path.join(savePath, 'mongodump.exe')) ||
      !fs.existsSync(path.join(savePath, 'mongorestore.exe'))
    ) {
      winston.debug('Windows platform detected. Downloading MongoDB Tools [' + filename + ']')
      fs.emptyDirSync(savePath)
      var unzipper = require('unzipper')
      var file = fs.createWriteStream(path.join(savePath, filename))
      http
        .get('http://storage.trudesk.io/tools/' + filename, function (response) {
          response.pipe(file)
          file.on('finish', function () {
            file.close()
          })
          file.on('close', function () {
            fs.createReadStream(path.join(savePath, filename))
              .pipe(unzipper.Extract({ path: savePath }))
              .on('close', function () {
                fs.unlink(path.join(savePath, filename), callback)
              })
          })
        })
        .on('error', function (err) {
          fs.unlink(path.join(savePath, filename))
          winston.debug(err)
          return callback()
        })
    } else {
      return callback()
    }
  } else {
    return callback()
  }
}

function timezoneDefault(callback) {
  SettingModel.getSettingByName('gen:timezone', function (err, setting) {
    if (err) {
      winston.warn(err)
      if (_.isFunction(callback)) return callback(err)
      return false
    }

    if (!setting) {
      var defaultTimezone = new SettingModel({
        name: 'gen:timezone',
        value: 'America/New_York',
      })

      defaultTimezone.save(function (err, setting) {
        if (err) {
          winston.warn(err)
          if (_.isFunction(callback)) return callback(err)
        }

        winston.debug('Timezone set to ' + setting.value)
        moment.tz.setDefault(setting.value)

        global.timezone = setting.value

        if (_.isFunction(callback)) return callback()
      })
    } else {
      winston.debug('Timezone set to ' + setting.value)
      moment.tz.setDefault(setting.value)

      global.timezone = setting.value

      if (_.isFunction(callback)) return callback()
    }
  })
}

function showTourSettingDefault(callback) {
  SettingModel.getSettingByName('showTour:enable', function (err, setting) {
    if (err) {
      winston.warn(err)
      if (_.isFunction(callback)) return callback(err)
      return false
    }

    if (!setting) {
      var defaultShowTour = new SettingModel({
        name: 'showTour:enable',
        value: 0,
      })

      defaultShowTour.save(function (err) {
        if (err) {
          winston.warn(err)
          if (_.isFunction(callback)) return callback(err)
        }

        if (_.isFunction(callback)) return callback()
      })
    } else if (_.isFunction(callback)) return callback()
  })
}

function ticketTypeSettingDefault(callback: any) {
  SettingModel.getSettingByName('ticket:type:default', async function (err, setting) {
    if (err) {
      winston.warn(err)
      if (_.isFunction(callback)) {
        return callback(err)
      }
    }

    if (!setting) {
      try {
        const types = await TicketTypeModel.getTypes()
        const type = _.first(types) as TicketTypeClass
        if (!type) throw new Error('Invalid Type. Skipping.')
        if (!_.isObject(type) || _.isUndefined(type._id))
            throw new Error('Invalid Type. Skipping.')

        const defaultTicketType = new SettingModel({
          name: 'ticket:type:default',
          value: type._id,
        })

        await defaultTicketType.save()

        if (typeof callback === 'function') return callback()
      } catch (err) {
        winston.warn(err)
        if (_.isFunction(callback)) {
          return callback(err)
        }
        return false
      }
    } else {
      if (_.isFunction(callback)) {
        return callback()
      }
    }
  })
}

async function defaultTicketStatus(callback: any) {
  const statuses: Array<TicketStatusClass> = [] 

  const newStatus = new TicketStatusModel({
    name: 'New',
    htmlColor: '#29b955',
    uid: 0,
    order: 0,
    slatimer: false,
    isResolved: false,
    isLocked: true
  })

  const openStatus = new TicketStatusModel({
    name: 'Open',
    htmlColor: '#d32f2f',
    uid: 1,
    order: 1,
    slatimer: true,
    isResolved: false,
    isLocked: true
  })

  const pendingStatus = new TicketStatusModel({
    name: 'Pending',
    htmlColor: '#2196F3',
    uid: 2,
    order: 2,
    slatimer: false,
    isResolved: false,
    isLocked: true
  })

  const closedStatus = new TicketStatusModel({
    name: 'Closed',
    htmlColor: '#CCCCCC',
    uid: 3,
    order: 3,
    slatimer: false,
    isResolved: true,
    isLocked: true
  })

  const hasNewStatus = await TicketStatusModel.countDocuments({name: 'New', isLocked: true, uid: 0}).count() > 0
  if (!hasNewStatus)
    statuses.push(newStatus)

  const hasOpenStatus = await TicketStatusModel.countDocuments({name: 'Open', isLocked: true, uid: 1}).count() > 0
  if (!hasOpenStatus)
    statuses.push(openStatus)

  const hasPendingStatus = await TicketStatusModel.countDocuments({name: 'Pending', isLocked: true, uid: 2}).count() > 0
  if (!hasPendingStatus)
    statuses.push(pendingStatus)

  const hasClosedStatus = await TicketStatusModel.countDocuments({name: 'Closed', isLocked: true, uid: 3}).count() > 0
  if (!hasClosedStatus)
    statuses.push(closedStatus)

  const p1 = new Promise<void>((resolve, reject) => {
    ;(async() => {
      try {
        statuses.forEach(async (i) => {
          await i.save()
        })

        return resolve()
      } catch (e) {
        return reject(e)
      }
    })()
  })

  Promise.all([p1]).then(() => {
    callback()
  }).catch((err) => callback(err))
}

async function ticketPriorityDefaults(callback: any) {
  const priorities = []

  const normal = new PriorityModel({
    name: 'Normal',
    migrationNum: 1,
    default: true,
  })

  const urgent = new PriorityModel({
    name: 'Urgent',
    migrationNum: 2,
    htmlColor: '#8e24aa',
    default: true,
  })

  const critical = new PriorityModel({
    name: 'Critical',
    migrationNum: 3,
    htmlColor: '#e65100',
    default: true,
  })

  priorities.push(normal)
  priorities.push(urgent)
  priorities.push(critical)

  priorities.forEach(async (item) => {
    try {
      const priority = await PriorityModel.findOne({ migrationNum: item.migrationNum })
      if (!priority)
        await item.save()
    } catch (err) {
      winston.error(`Error: ${err}`)
    }
  }, Error())

  return callback()
}

function normalizeTags(callback : any) {
  TicketTagModel.find({}, function (err, tags) {
    if (err) return callback(err)
    async.each(
      tags,
      function (tag, next) {
        tag.save(next)
      },
      callback
    )
  })
}

function checkPriorities(callback: any) {
  let migrateP1 = false
  let migrateP2 = false
  let migrateP3 = false

  async.parallel(
    [
      function (done) {
        TicketModel.collection.countDocuments({ priority: 1 }).then(function (count) {
          migrateP1 = count > 0
          return done()
        })
      },
      function (done) {
        TicketModel.collection.countDocuments({ priority: 2 }).then(function (count) {
          migrateP2 = count > 0
          return done()
        })
      },
      function (done) {
        TicketModel.collection.countDocuments({ priority: 3 }).then(function (count) {
          migrateP3 = count > 0
          return done()
        })
      },
    ],
    function () {
      const p1 = new Promise<void>((resolve, reject) => {
        (async ():Promise<void> => {
          if (!migrateP1) return resolve()
          try {
            const normal = await PriorityModel.getByMigrationNum(1)
            if (!normal) throw new Error('Invalid priority!')
            winston.debug('Converting Priority: Normal')

            const res = await TicketModel.collection
              .updateMany({ priority: 1 }, { $set: { priority: normal._id } })

            if (res && res.result) {
              if (res.result.ok === 1) {
                return resolve()
              }

              winston.warn(res.message)
              return resolve(res.message)
            }
          } catch (err: any) {
            winston.warn(err.message)
            return reject(err)
          }
        })()
      })

      const p2 = new Promise<void>((resolve, reject) => {
        (async ():Promise<void> => {
          if (!migrateP1) return resolve()
          try {
            const urgent = await PriorityModel.getByMigrationNum(2)
            if (!urgent) throw new Error('Invalid priority!')
            winston.debug('Converting Priority: Urgent')

            const res = await TicketModel.collection
              .updateMany({ priority: 1 }, { $set: { priority: urgent._id } })

            if (res && res.result) {
              if (res.result.ok === 1) {
                return resolve()
              }

              winston.warn(res.message)
              return resolve(res.message)
            }
          } catch (err: any) {
            winston.warn(err.message)
            return reject(err)
          }
        })()
      })

      const p3 = new Promise<void>((resolve, reject) => {
        (async ():Promise<void> => {
          if (!migrateP1) return resolve()
          try {
            const critical = await PriorityModel.getByMigrationNum(3)
            if (!critical) throw new Error('Invalid priority!')
            winston.debug('Converting Priority: Critical')

            const res = await TicketModel.collection
              .updateMany({ priority: 1 }, { $set: { priority: critical._id } })

            if (res && res.result) {
              if (res.result.ok === 1) {
                return resolve()
              }

              winston.warn(res.message)
              return resolve(res.message)
            }
          } catch (err: any) {
            winston.warn(err.message)
            return reject(err)
          }
        })()
      })

      Promise.all([p1, p2, p3]).then(() => {
        callback()
      }).catch(err => callback(err))
    }
  )
}

async function addedDefaultPrioritiesToTicketTypes(callback: any) {
  try {
    let priorities = await PriorityModel.find({ default: true })
    priorities = _.sortBy(priorities, 'migrationNum')
    const types = await TicketTypeModel.getTypes()
    for (const type of types) {
      let prioritiesToAdd: Types.ObjectId[] = []
      if (!type.priorities || type.priorities.length < 1) {
        type.priorities = []
        prioritiesToAdd = _.map(priorities, '_id')
      }

      if (prioritiesToAdd.length > 1) {
        type.priorities = _.concat(type.priorities, prioritiesToAdd)
        await type.save()
      }
    }

    return callback()
  } catch (err) {
    return callback(err)
  }
}

function mailTemplates(callback) {
  var newTicket = require('./json/mailer-new-ticket')
  var passwordReset = require('./json/mailer-password-reset')
  var templateSchema = require('../models/template')
  async.parallel(
    [
      function (done) {
        templateSchema.findOne({ name: newTicket.name }, function (err, templates) {
          if (err) return done(err)
          if (!templates || templates.length < 1) {
            return templateSchema.create(newTicket, done)
          }

          return done()
        })
      },
      function (done) {
        templateSchema.findOne({ name: passwordReset.name }, function (err, templates) {
          if (err) return done(err)
          if (!templates || templates.length < 1) {
            return templateSchema.create(passwordReset, done)
          }

          return done()
        })
      },
    ],
    callback
  )
}

function elasticSearchConfToDB(callback) {
  const nconf = require('nconf')
  const elasticsearch = {
    enable: nconf.get('elasticsearch:enable') || false,
    host: nconf.get('elasticsearch:host') || 'http://localhost',
    port: nconf.get('elasticsearch:port') || 9200,
  }

  nconf.set('elasticsearch', {})

  async.parallel(
    [
      function (done) {
        nconf.save(done)
      },
      function (done) {
        // if (!elasticsearch.enable) return done()
        SettingModel.getSettingByName('es:enable', function (err, setting) {
          if (err) return done(err)
          if (!setting) {
            SettingModel.create(
              {
                name: 'es:enable',
                value: elasticsearch.enable,
              },
              done
            )
          } else done()
        })
      },
      function (done) {
        if (!elasticsearch.host) elasticsearch.host = 'localhost'
        SettingModel.getSettingByName('es:host', function (err, setting) {
          if (err) return done(err)
          if (!setting) {
            SettingModel.create(
              {
                name: 'es:host',
                value: elasticsearch.host,
              },
              done
            )
          } else done()
        })
      },
      function (done) {
        if (!elasticsearch.port) return done()
        SettingModel.getSettingByName('es:port', function (err, setting) {
          if (err) return done(err)
          if (!setting) {
            SettingModel.create(
              {
                name: 'es:port',
                value: elasticsearch.port,
              },
              done
            )
          } else done()
        })
      },
    ],
    callback
  )
}

function installationID(callback) {
  const Chance = require('chance')
  const chance = new Chance()
  SettingModel.getSettingByName('gen:installid', function (err, setting) {
    if (err) return callback(err)
    if (!setting) {
      SettingModel.create(
        {
          name: 'gen:installid',
          value: chance.guid(),
        },
        callback
      )
    } else {
      return callback()
    }
  })
}

async function maintenanceModeDefault() {
  return new Promise<void>((resolve, reject) => {
    ;(async () => {
      try {
        const setting = await SettingModel.getSettingByName('maintenanceMode:enable')
        if (!setting) {
          await SettingModel.create({ name: 'maintenanceMode:enable', value: false })
          return resolve()
        } else {
          return resolve()
        }
      } catch (e) {
        return reject(e)
      }
    })()
  })
}

export const init = function (callback: () => void) {
  winston.debug('Checking Default Settings...')
  series(
    [
      function (done) {
        return createDirectories(done)
      },
      function (done) {
        return downloadWin32MongoDBTools(done)
      },
      function (done) {
        return rolesDefault(done)
      },
      function (done) {
        return defaultUserRole(done)
      },
      function (done) {
        return timezoneDefault(done)
      },
      function (done) {
        return ticketTypeSettingDefault(done)
      },
      function (done) {
        return defaultTicketStatus(done)
      },
      function (done) {
        return ticketPriorityDefaults(done)
      },
      function (done) {
        return addedDefaultPrioritiesToTicketTypes(done)
      },
      function (done) {
        return checkPriorities(done)
      },
      function (done) {
        return normalizeTags(done)
      },
      function (done) {
        return mailTemplates(done)
      },
      function (done) {
        return elasticSearchConfToDB(done)
      },
      function (done) {
        return maintenanceModeDefault().then(() => {
          done()
        })
      },
      function (done) {
        return installationID(done)
      },
    ],
    function (err) {
      if (err) winston.warn(err)
      if (typeof callback === 'function') return callback()
    }
  )
}

settingsDefaults.init = init

export default settingsDefaults
module.exports = settingsDefaults
